/*eslint-disable no-undef */
const http = require('http')
const net = require('net')
const zlib = require('zlib')
const {default: axios} = require('axios')
const PriceProviderBase = require('../src/providers/price-provider-base')
const RequestError = require('../src/providers/request-error')
const Pair = require('../src/models/pair')
const {getAsset} = require('../src/assets-cache')
const {fetchPairTradesData, ensureMarketLoaded} = require('../src')

class TestProvider extends PriceProviderBase {
    name = 'test'
}

let server
let baseUrl
let gatewayHits = 0
let directHits = 0

/**
 * @param {http.IncomingMessage} req - request
 * @param {http.ServerResponse} res - response
 * @returns {void}
 */
function handle(req, res) {
    const {pathname, searchParams} = new URL(req.url, 'http://127.0.0.1')
    if (pathname === '/gateway') {
        gatewayHits++
        const target = new URL(searchParams.get('url'))
        if (target.pathname === '/gateway-down') {
            res.writeHead(502)
            return res.end()
        }
        res.writeHead(200, {'content-type': 'application/json'})
        return res.end(JSON.stringify({via: 'gateway', seen: req.headers['x-gateway-validation'] ?? null}))
    }
    switch (pathname) {
        case '/ok':
        case '/gateway-down':
            directHits++
            res.writeHead(200, {'content-type': 'application/json'})
            return res.end(JSON.stringify({via: 'direct', seen: req.headers['x-gateway-validation'] ?? null}))
        case '/slow': {
            res.writeHead(200, {'content-type': 'application/json'})
            res.write('[')
            const drip = setInterval(() => res.write('1,'), 200)
            req.on('close', () => clearInterval(drip))
            return undefined
        }
        case '/big':
            res.writeHead(200, {'content-type': 'text/plain'})
            return res.end(Buffer.alloc(6 * 1024 * 1024, 97))
        case '/truncated':
            res.writeHead(200, {'content-type': 'application/json', 'content-length': '1000'})
            res.write('12345678')
            return res.destroy()
        case '/bomb':
            res.writeHead(200, {'content-encoding': 'gzip', 'content-type': 'text/plain'})
            return res.end(zlib.gzipSync(Buffer.alloc(6 * 1024 * 1024, 97)))
        case '/redirect':
            res.writeHead(302, {location: `${baseUrl}/ok`})
            return res.end()
        case '/rate-limited':
            res.writeHead(429)
            return res.end()
        case '/broken':
            res.writeHead(500)
            return res.end()
        default:
            res.writeHead(404)
            return res.end()
    }
}

beforeAll(async () => {
    server = http.createServer(handle)
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
    jest.spyOn(console, 'debug').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    jest.restoreAllMocks()
})

afterEach(() => {
    PriceProviderBase.setGateway(null)
    gatewayHits = 0
    directHits = 0
    console.warn.mockClear()
    console.error.mockClear()
})

const provider = new TestProvider()

describe('__makeRequest egress limits', () => {
    test('returns the response for a healthy upstream', async () => {
        const response = await provider.__makeRequest(`${baseUrl}/ok`)
        expect(response.data.via).toBe('direct')
    })

    test('abandons a slow-drip response at the deadline and marks it retryable', async () => {
        const start = Date.now()
        const error = await provider.__makeRequest(`${baseUrl}/slow`, {timeout: 500}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(true)
        expect(Date.now() - start).toBeLessThan(3000)
    })

    test('caps the deadline at 10 s', async () => {
        expect(PriceProviderBase.maxDeadline).toBe(10000)
        const start = Date.now()
        await expect(provider.__makeRequest(`${baseUrl}/slow`, {timeout: 60000})).rejects.toBeInstanceOf(RequestError)
        const elapsed = Date.now() - start
        expect(elapsed).toBeGreaterThan(8000)
        expect(elapsed).toBeLessThan(13500)
    }, 15000)

    test('rejects an oversized body and does not follow redirects', async () => {
        const big = await provider.__makeRequest(`${baseUrl}/big`).catch(e => e)
        expect(big).toBeInstanceOf(RequestError)
        expect(big.retryable).toBe(false)
        const redirect = await provider.__makeRequest(`${baseUrl}/redirect`).catch(e => e)
        expect(redirect.status).toBe(302)
        expect(redirect.retryable).toBe(false)
    })

    test('a provider cannot loosen the egress limits with per-request options', async () => {
        let error = await provider.__makeRequest(`${baseUrl}/redirect`, {maxRedirects: 5}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(302)

        error = await provider.__makeRequest(`${baseUrl}/big`, {maxContentLength: Infinity, maxBodyLength: Infinity}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(false)

        error = await provider.__makeRequest(`${baseUrl}/redirect`, {validateStatus: () => true}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(302)
    })

    test('a 2xx that dies mid-body is retryable', async () => {
        const error = await provider.__makeRequest(`${baseUrl}/truncated`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        if (error.status !== null)
            expect(error.status).toBe(200)
        expect(error.retryable).toBe(true)
    })

    test('rejects a compressed body that inflates past the cap', async () => {
        const error = await provider.__makeRequest(`${baseUrl}/bomb`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.retryable).toBe(false)
    })

    test('rejects an invalid url without leaking it into the error', async () => {
        const error = await provider.__makeRequest('not a url').catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.host).toBe('invalid-url')
        expect(error.retryable).toBe(false)
        expect(error.message).not.toContain('not a url')
    })

    test('composes a caller signal with the deadline', async () => {
        const controller = new AbortController()
        controller.abort()
        const error = await provider.__makeRequest(`${baseUrl}/ok`, {signal: controller.signal}).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.code).toBe('ERR_CANCELED')
        expect(error.retryable).toBe(true)
    })

    test('classifies statuses', async () => {
        expect((await provider.__makeRequest(`${baseUrl}/rate-limited`).catch(e => e)).retryable).toBe(true)
        expect((await provider.__makeRequest(`${baseUrl}/broken`).catch(e => e)).retryable).toBe(true)
        expect((await provider.__makeRequest(`${baseUrl}/missing`).catch(e => e)).retryable).toBe(false)
    })

    test('logs the host and status but neither the url nor the raw error', async () => {
        await provider.__makeRequest(`${baseUrl}/broken?apiKey=SECRET123`).catch(() => {})
        const logged = JSON.stringify(console.warn.mock.calls)
        expect(logged).not.toContain('SECRET123')
        expect(logged).not.toContain('/broken')
        expect(console.warn.mock.calls[0][0].status).toBe(500)
        expect(console.warn.mock.calls[0][0].host).toContain('127.0.0.1')
    })

    test('leaves the process-global axios defaults untouched', () => {
        expect(axios.defaults.httpAgent).toBeUndefined()
        expect(axios.defaults.httpsAgent).toBeUndefined()
    })
})

describe('gateway routing never falls back to direct', () => {
    test('setGateway copies its input and the header only reaches the gateway', async () => {
        const list = [baseUrl]
        PriceProviderBase.setGateway(list, 'key', true)
        expect(list).toEqual([baseUrl])
        expect(PriceProviderBase.gatewayUrls).toEqual([undefined, baseUrl])
        PriceProviderBase.setGateway([baseUrl], 'key')
        const response = await provider.__makeRequest('https://upstream.example/ok')
        expect(response.data).toEqual({via: 'gateway', seen: 'key'})
        expect(console.error).not.toHaveBeenCalled()
    })

    test('every gateway failing does not produce a direct request', async () => {
        PriceProviderBase.setGateway([baseUrl, baseUrl], 'key')
        const error = await provider.__makeRequest(`${baseUrl}/gateway-down`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(502)
        expect(gatewayHits).toBe(2) //both configured slots were tried
        expect(directHits).toBe(0) //and the node ip never reached the upstream
    })

    test('a deterministic upstream failure is not retried through other routes', async () => {
        PriceProviderBase.setGateway([`${baseUrl}/nope`], 'key')
        const error = await provider.__makeRequest(`${baseUrl}/missing`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.status).toBe(404)
        expect(directHits).toBe(0)
    })

    test('an unparseable gateway is dropped and never named in a log', () => {
        PriceProviderBase.setGateway(['http://user:TOPSECRET@', baseUrl], 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([baseUrl])
        expect(console.warn).toHaveBeenCalledTimes(1)
        expect(JSON.stringify(console.warn.mock.calls)).not.toContain('TOPSECRET')
        expect(console.warn.mock.calls[0][0]).toEqual({msg: 'Ignored unparseable gateway urls', ignored: 1, kept: 1})
    })

    test('a list of only unusable gateways fails closed instead of going direct', async () => {
        PriceProviderBase.setGateway(['http://user:TOPSECRET@', 42], 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([]) //configured but unusable, which is not the same as unconfigured
        expect(PriceProviderBase.getRoutes(`${baseUrl}/ok`)).toEqual([])
        const error = await provider.__makeRequest(`${baseUrl}/ok`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.code).toBe('ERR_NO_GATEWAY')
        expect(error.retryable).toBe(false)
        expect(directHits).toBe(0)
        expect(gatewayHits).toBe(0)
        //loud, and specific about how many were configured and why each was dropped, without naming any of them
        expect(console.error).toHaveBeenCalledTimes(1)
        expect(console.error.mock.calls[0][0].configured).toBe(2)
        expect(console.error.mock.calls[0][0].reasons).toEqual(['#0: unparseable', '#1: not-a-string (number)'])
        expect(JSON.stringify(console.error.mock.calls)).not.toContain('TOPSECRET')
    })

    test('an empty list means no gateways configured, so direct stays the only route', async () => {
        PriceProviderBase.setGateway([], 'key')
        expect(PriceProviderBase.gatewayUrls).toBeNull()
        expect(console.error).not.toHaveBeenCalled()
        const response = await provider.__makeRequest(`${baseUrl}/ok`)
        expect(response.data).toEqual({via: 'direct', seen: null})
    })

    test('useCurrentProvider keeps the local host as a chosen route', async () => {
        PriceProviderBase.setGateway([baseUrl], 'key', true)
        expect(PriceProviderBase.getRoutes(`${baseUrl}/gateway-down`)).toEqual([baseUrl, undefined])
        //the operator opted the local host in, so it is a route in its own right, not a fall-back
        const response = await provider.__makeRequest(`${baseUrl}/gateway-down`)
        expect(response.data).toEqual({via: 'direct', seen: null})
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(1)
    })

    test('a failure over an unparseable gateway is a RequestError, never a TypeError', async () => {
        //bypass setGateway so the walk itself has to survive an entry setGateway would have rejected
        PriceProviderBase.gatewayUrls = ['http://user:TOPSECRET@']
        PriceProviderBase.validationKey = 'key'
        const error = await provider.__makeRequest(`${baseUrl}/missing`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error).not.toBeInstanceOf(TypeError)
        expect(directHits).toBe(0)
        expect(JSON.stringify({...error, message: error.message})).not.toContain('TOPSECRET')
        expect(JSON.stringify(console.warn.mock.calls)).not.toContain('TOPSECRET')
    })

    test('the route list holds gateways only, unless the local host was chosen', () => {
        PriceProviderBase.setGateway(['http://gw-a', 'http://gw-b'], 'key')
        const gatewaysOnly = PriceProviderBase.getRoutes('https://upstream.example/x')
        expect(gatewaysOnly).not.toContain(undefined)
        expect([...gatewaysOnly].sort()).toEqual(['http://gw-a', 'http://gw-b'])

        PriceProviderBase.setGateway(['http://gw-a', 'http://gw-b'], 'key', true)
        const withLocalHost = PriceProviderBase.getRoutes('https://upstream.example/x')
        expect(withLocalHost.filter(r => r === undefined)).toHaveLength(1)
        expect(withLocalHost[withLocalHost.length - 1]).toBeUndefined()
        expect(new Set(withLocalHost).size).toBe(withLocalHost.length)
        expect([...withLocalHost].sort()).toEqual([undefined, 'http://gw-a', 'http://gw-b'].sort())

        PriceProviderBase.setGateway(null)
        expect(PriceProviderBase.getRoutes('https://upstream.example/x')).toEqual([undefined])
    })
})

describe('a node with no usable gateway loses the tick cleanly', () => {
    class RequestingProvider extends PriceProviderBase {
        name = 'requesting'

        __loadMarkets(timeout) {
            return this.__makeRequest(`${baseUrl}/markets`, {timeout}).then(response => response.data)
        }

        __getTradeData(pair, timestamp, timeframe, count, timeout) {
            return this.__makeRequest(`${baseUrl}/klines`, {timeout}).then(response => response.data)
        }
    }

    test('the failure reaches the callers as a RequestError, not as an exception from an empty walk', async () => {
        const requesting = new RequestingProvider()
        requesting.markets = ['BTCUSDT']
        PriceProviderBase.setGateway(['http://user:TOPSECRET@'], 'key')

        const pair = new Pair(getAsset('USD'), getAsset('BTC'))
        const trades = await fetchPairTradesData(requesting, pair, 1700000000, 1, 2, 1000)
        expect(trades).toHaveLength(2)
        expect(trades.every(trade => trade.volume === 0n && trade.completed)).toBe(true) //no data, the accepted cost

        await expect(ensureMarketLoaded(requesting, 1000)).resolves.toBeUndefined()

        expect(directHits).toBe(0)
        expect(gatewayHits).toBe(0)
        expect(JSON.stringify(console.warn.mock.calls)).toContain('ERR_NO_GATEWAY')
    })
})

describe('a configured entry that is not a routable url fails closed', () => {
    //counted at the socket, so an outbound attempt is seen even when nothing ever answers it
    let socketAttempts = 0
    const realConnect = net.Socket.prototype.connect

    beforeAll(() => {
        net.Socket.prototype.connect = function (...args) {
            socketAttempts++
            return realConnect.apply(this, args)
        }
    })

    afterAll(() => {
        net.Socket.prototype.connect = realConnect
    })

    beforeEach(() => {
        socketAttempts = 0
    })

    //`undefined` is also how useCurrentProvider names the
    //local host; a configured list holding nothing else must still fail closed rather than send every request direct
    test.each([
        {name: 'a single undefined entry', build: () => [undefined]},
        {name: 'three undefined entries', build: () => [undefined, undefined, undefined]},
        {name: 'an array of holes', build: () => new Array(3)},
        {name: 'a hole followed by a null', build: () => {
            const list = new Array(2)
            list.push(null)
            return list
        }},
        {name: 'a null entry', build: () => [null]},
        {name: 'an empty string', build: () => ['']},
        {name: 'whitespace', build: () => ['   ']},
        {name: 'a number', build: () => [42]},
        {name: 'an object', build: () => [{url: 'http://gw-a'}]},
        {name: 'an array', build: () => [['http://gw-a']]},
        {name: 'a boolean', build: () => [false]}
    ])('$name is not a usable gateway, so the request fails closed', async ({build}) => {
        PriceProviderBase.setGateway(build(), 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([]) //configured with nothing usable, which is not unconfigured
        expect(PriceProviderBase.getRoutes(`${baseUrl}/ok`)).toEqual([])
        const error = await provider.__makeRequest(`${baseUrl}/ok`).catch(e => e)
        expect(error).toBeInstanceOf(RequestError)
        expect(error.code).toBe('ERR_NO_GATEWAY')
        expect(directHits).toBe(0) //nothing reached the upstream
        expect(gatewayHits).toBe(0)
        expect(socketAttempts).toBe(0) //and no socket was opened for it at all
    })

    test('useCurrentProvider does not turn a caller-supplied undefined into a route', async () => {
        PriceProviderBase.setGateway([undefined], 'key', true)
        expect(PriceProviderBase.gatewayUrls).toEqual([]) //the opt-in is added after the fail-closed return, not before
        const error = await provider.__makeRequest(`${baseUrl}/ok`).catch(e => e)
        expect(error.code).toBe('ERR_NO_GATEWAY')
        expect(directHits).toBe(0)
        expect(socketAttempts).toBe(0)
    })

    test('a hole before a real gateway leaves the real gateway usable', async () => {
        const sparse = new Array(2)
        sparse.push(baseUrl)
        PriceProviderBase.setGateway(sparse, 'key')
        expect(PriceProviderBase.gatewayUrls).toEqual([baseUrl]) //the holes are dropped, the gateway is kept
        const response = await provider.__makeRequest('https://upstream.example/ok')
        expect(response.data).toEqual({via: 'gateway', seen: 'key'})
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(0)
    })

    test('the opt-in local host is still a route, because it is added after the filter', async () => {
        PriceProviderBase.setGateway([baseUrl], 'key', true)
        expect(PriceProviderBase.gatewayUrls).toEqual([undefined, baseUrl])
        //the gateway is walked first and answers 502, then the route the operator opted into serves the request
        const response = await provider.__makeRequest(`${baseUrl}/gateway-down`)
        expect(response.data).toEqual({via: 'direct', seen: null})
        expect(gatewayHits).toBe(1)
        expect(directHits).toBe(1)
    })
})
