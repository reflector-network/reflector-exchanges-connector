/*eslint-disable class-methods-use-this */
const https = require('https')
const http = require('http')
const {default: axios} = require('axios')
const TradeData = require('../models/trade-data')
const RequestError = require('./request-error')

//egress limits shared by every request: a total deadline, a body cap, no redirects
const maxDeadline = 10000
const maxBodyBytes = 5 * 1024 * 1024
const defaultAgentOptions = {keepAlive: true, maxSockets: 50, noDelay: true}

//only a 2xx is a success; used for both the client defaults and the per-request options so a provider cannot loosen it
const acceptedStatus = status => status >= 200 && status < 300

const requestedUrls = new Map()

//a dedicated client, so the process-global axios defaults stay untouched and no other package can undo the limits
const client = axios.create({
    httpAgent: new http.Agent(defaultAgentOptions),
    httpsAgent: new https.Agent(defaultAgentOptions),
    maxRedirects: 0,
    maxContentLength: maxBodyBytes,
    maxBodyLength: maxBodyBytes,
    validateStatus: acceptedStatus
})

/**
 * @param {number} index - current index
 * @param {number} length - list length
 * @returns {number}
 */
function getRotatedIndex(index, length) {
    return (index + 1) % length
}

/**
 * @param {string} gatewayUrl - gateway url or undefined for direct
 * @returns {string} host for logs; never throws and never carries credentials
 */
function routeHost(gatewayUrl) {
    if (!gatewayUrl)
        return 'direct'
    try {
        return new URL(gatewayUrl).host
    } catch (e) {
        return 'invalid-gateway'
    }
}

/**
 * Judges one entry of the operator's configured list. The direct route is never judged here: it is not a configured
 * entry, `setGateway` injects it after this filter has run. An `undefined` that arrived from the caller - a literal
 * `[undefined]`, or an array hole the spread turns into one - is therefore rejected like any other non-string
 * instead of being read as the opt-in local host and sending the request direct.
 * @param {any} gatewayUrl - configured gateway entry
 * @returns {string|null} why the entry cannot be used, or null when it can; the entry itself is never echoed back
 */
function gatewayRejectionReason(gatewayUrl) {
    if (typeof gatewayUrl !== 'string') //undefined and null included: neither of them names a route
        return `not-a-string (${typeof gatewayUrl})`
    let parsed
    try {
        parsed = new URL(gatewayUrl)
    } catch (e) {
        return 'unparseable'
    }
    return parsed.host ? null : 'no-host'
}

/**
 * @param {any} gatewayUrl - configured gateway entry
 * @returns {boolean} true when the entry is usable, so an unusable one never reaches the route list
 */
function isUsableGateway(gatewayUrl) {
    return gatewayRejectionReason(gatewayUrl) === null
}

class PriceProviderBase {
    constructor(apiKey, secret) {
        if (this.constructor === PriceProviderBase)
            throw new Error('PriceProviderBase is an abstract class and cannot be instantiated')
        this.apiKey = apiKey
        this.secret = secret
        this.markets = []
        this.cachedSymbols = {}
    }

    /**
     * Records one of three states in `gatewayUrls`, and only the first of them may issue a direct request.
     * `null` - no gateways configured, so direct is the only route.
     * A non-empty list - at least one usable gateway: every request goes through a gateway, and direct is a route only
     * when `useCurrentProvider` put it in the list.
     * An empty list - gateways configured and none of them usable: no route at all, so requests fail instead of
     * revealing the node ip to the upstream.
     * @param {string|string[]} gatewayConnectionSting - configured gateway urls
     * @param {string} validationKey - value of the x-gateway-validation header
     * @param {boolean} [useCurrentProvider] - route through the local host as well, as one explicitly chosen route;
     * this is the only thing that puts the direct route in the list
     */
    static setGateway(gatewayConnectionSting, validationKey, useCurrentProvider) {
        if (!gatewayConnectionSting) {
            PriceProviderBase.gatewayUrls = null
            PriceProviderBase.validationKey = null
            return
        }

        if (!Array.isArray(gatewayConnectionSting))
            gatewayConnectionSting = [gatewayConnectionSting]

        const configured = [...gatewayConnectionSting]
        //an empty list is "no gateways configured", not a configuration that failed: reflector-node synthesises
        //{urls: []} the first time a node boots without a gateways.json (src/domain/settings-manager.js:92-96) and
        //hands that straight to setGateway, so fail-closing here would leave every freshly provisioned node unable
        //to fetch any data at all
        if (configured.length === 0) {
            PriceProviderBase.gatewayUrls = null
            PriceProviderBase.validationKey = null
            return
        }
        //an unusable entry would throw out of every log line and break the route walk, so drop it here and never name it
        const proxies = configured.filter(isUsableGateway)

        if (proxies.length === 0) {
            //fail closed: going direct would expose the node ip, which is the one thing the gateways exist to prevent
            const reasons = configured.map((gateway, index) => `#${index}: ${gatewayRejectionReason(gateway)}`)
            console.error({msg: 'Every configured gateway is unusable; requests will fail instead of going direct', configured: configured.length, reasons})
            PriceProviderBase.gatewayUrls = []
            PriceProviderBase.validationKey = null
            return
        }

        if (proxies.length !== configured.length)
            console.warn({msg: 'Ignored unparseable gateway urls', ignored: configured.length - proxies.length, kept: proxies.length})

        //the only undefined that can reach the list: it is added after the configured entries were validated and
        //after the fail-closed return, so a caller-supplied undefined can never pass for the opt-in local host
        if (useCurrentProvider) //add current server as one more chosen route, never as a fall-back
            proxies.unshift(undefined)

        PriceProviderBase.gatewayUrls = proxies
        PriceProviderBase.validationKey = validationKey
    }

    static getGatewayUrl(url) {
        const gateways = PriceProviderBase.gatewayUrls
        if (!gateways || gateways.length === 0) //no proxies, or none usable - what that means is getRoutes' decision
            return undefined

        if (gateways.length === 1) //single gateway, no need to rotate
            return gateways[0]

        const host = new URL(url).host
        if (!requestedUrls.has(host)) {//first request to the host. Assign first gateway
            requestedUrls.set(host, 0)
            return gateways[0]
        }
        const index = requestedUrls.get(host)
        const newIndex = getRotatedIndex(index, gateways.length)
        requestedUrls.set(host, newIndex)
        return gateways[newIndex]
    }

    /**
     * Total deadline applied to every request, in milliseconds; a provider's own timeout is capped at it.
     * @type {number}
     */
    static maxDeadline = maxDeadline

    /**
     * Ordered routes for one request, one shape per state of `gatewayUrls`.
     * No gateways configured - a single direct route (`undefined`).
     * Gateways configured - the rotated gateway first, then the remaining configured gateways in order (duplicates
     * preserved, so each configured slot still gets its own attempt). Direct is appended, once and last, only when the
     * list contains it because `useCurrentProvider` opted the local host in, never as a fall-back.
     * Gateways configured and none usable - no routes at all, so the caller fails instead of going direct.
     * @param {string} url - upstream url
     * @returns {Array<string|undefined>}
     */
    static getRoutes(url) {
        const gateways = PriceProviderBase.gatewayUrls
        if (!gateways) //no gateways configured
            return [undefined]
        if (gateways.length === 0) //configured, none usable
            return []
        const first = PriceProviderBase.getGatewayUrl(url)
        const remaining = [...gateways]
        const firstIndex = remaining.indexOf(first)
        if (firstIndex !== -1) //drop the single slot already picked as the rotated first route
            remaining.splice(firstIndex, 1)
        const routes = first !== undefined ? [first] : []
        for (const gateway of remaining) {
            if (gateway !== undefined) //the chosen direct route is appended once below, wherever it sits in the config
                routes.push(gateway)
        }
        if (gateways.includes(undefined)) //useCurrentProvider named the local host as a route; that is a choice, not a fall-back
            routes.push(undefined)
        return routes
    }

    /**
     * One request over one route.
     * @param {string} url - upstream url
     * @param {any} options - axios request options; `timeout` is capped at `maxDeadline`
     * @param {string} [gatewayUrl] - gateway to route through, or undefined for a direct request
     * @returns {Promise<any>} axios response with a 2xx status
     * @throws {RequestError} on any transport or HTTP failure
     */
    static async sendRequest(url, options, gatewayUrl) {
        let targetHost
        try {
            targetHost = new URL(url).host
        } catch (e) {
            throw new RequestError('invalid-url', {code: 'ERR_INVALID_URL'})
        }
        const requested = Number(options?.timeout)
        const deadline = Math.min(requested > 0 ? requested : maxDeadline, maxDeadline)
        let headers = options?.headers
        let requestUrl = url
        if (gatewayUrl) {
            requestUrl = `${gatewayUrl}/gateway?url=${encodeURIComponent(url)}`
            headers = {...headers, 'x-gateway-validation': PriceProviderBase.validationKey}
        }
        const requestOptions = {
            ...options,
            headers,
            url: requestUrl,
            timeout: deadline,
            signal: options?.signal ? AbortSignal.any([AbortSignal.timeout(deadline), options.signal]) : AbortSignal.timeout(deadline),
            maxRedirects: 0,
            maxContentLength: maxBodyBytes,
            maxBodyLength: maxBodyBytes,
            validateStatus: acceptedStatus
        }
        const start = Date.now()
        try {
            const response = await client.request(requestOptions)
            const durationMs = Date.now() - start
            if (durationMs > 1000)
                console.debug({msg: 'Slow request', host: targetHost, route: routeHost(gatewayUrl), durationMs})
            return response
        } catch (err) {
            const error = new RequestError(targetHost, {status: err.response?.status, code: err.code})
            console.warn({msg: 'Request failed', host: targetHost, route: routeHost(gatewayUrl), status: error.status, code: error.code, durationMs: Date.now() - start})
            throw error
        }
    }

    /**
     * @type {string}
     * @readonly
     */
    name = ''
    /**
     * @type {string}
     * @protected
     */
    apiKey
    /**
     * @type {string}
     * @protected
     */
    secret
    /**
     * @type {number}
     * @readonly
     */
    marketsLoadedAt = 0
    /**
     * @type {{}}
     * @protected
     */
    cachedSymbols

    /**
     * @param {number} [timeout] - request timeout in milliseconds. Default is 3000ms
     * @returns {Promise<void>}
     */
    async loadMarkets(timeout = 3000) {
        const markets = await this.__loadMarkets(timeout)
        this.cachedSymbols = {} //clear cache
        this.marketsLoadedAt = Date.now() //set timestamp
        this.markets = markets //set markets
    }

    /**
     * @param {number} timeout - request timeout in milliseconds
     * @returns {Promise<Array<string>>} Returns supported symbols
     * @abstract
     * @protected
     */
    __loadMarkets(timeout) { //eslint-disable-line no-unused-vars
        throw new Error('Not implemented')
    }

    /**
     *
     * @param {Pair} pair - pair to get trades data for
     * @param {number} timestamp - timestamp in seconds
     * @param {number} timeframe - timeframe in minutes
     * @param {number} count - number of candles to get
     * @param {number} [timeout] - request timeout in milliseconds. Default is 3000ms
     * @returns {Promise<TradeData[]|null>} Returns TradeData array in ascending order or null if no data
     */
    getTradesData(pair, timestamp, timeframe, count, timeout = 3000) {
        if (count < 1)
            throw new Error('Count should be greater than 0')
        if (pair.base.name === pair.quote.name) {
            return Array(count).fill(
                new TradeData({
                    volume: 1,
                    quoteVolume: 1,
                    inversed: false,
                    source: this.name
                })
            )
        }
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return this.__processKlines([], timestamp, false, timeframe, count)
        return this.__getTradeData(pair, timestamp, timeframe, count, timeout)
    }

    /**
     * @param {any[]} klines - klines data
     * @param {number} timestamp - timestamp in seconds
     * @param {boolean} inversed - is pair inversed
     * @param {number} timeframe - timeframe in minutes
     * @param {number} count - number of candles to get
     * @returns {TradeData[]} Returns TradeData array in ascending order
     */
    __processKlines(klines, timestamp, inversed, timeframe, count) {
        if (!klines)
            klines = []
        const tradesData = Array(count).fill()
        const timeframeSeconds = timeframe * 60
        let currentTimestamp = timestamp
        for (let i = 0; i < count; i++) {
            const tradeData = klines[i] ? this.__processSingleKline(klines[i], inversed) : {}
            if (tradeData.ts === currentTimestamp) { //if not trades happened, the timestamp will be empty
                tradesData[i] = tradeData
            } else { //if no trades happened, create empty trade
                tradesData[i] = new TradeData({
                    ts: currentTimestamp,
                    volume: 0,
                    quoteVolume: 0,
                    inversed,
                    source: this.name,
                    completed: true
                })
            }
            currentTimestamp += timeframeSeconds
        }
        this.__validateTimestamps(timestamp, tradesData.map(t => t.ts), timeframeSeconds)
        return tradesData
    }

    /**
     * @param {Pair} pair - pair to get trades data for
     * @param {number} timestamp - timestamp in seconds
     * @param {number} timeframe - timeframe in minutes
     * @param {number} count - number of candles to get
     * @param {number} timeout - request timeout in milliseconds
     * @abstract
     * @protected
     */
    __getTradeData(pair, timestamp, timeframe, count, timeout) { //eslint-disable-line no-unused-vars
        throw new Error('Not implemented')
    }

    /**
     * @param {Pair} pair - pair to get symbol info for
     * @returns {{symbol: string, inversed: boolean} | null}
     */
    getSymbolInfo(pair) {
        if (this.cachedSymbols[pair.name] !== undefined)
            return this.cachedSymbols[pair.name]

        return this.cachedSymbols[pair.name] = this.__getSymbol(pair.base, pair.quote) || this.__getSymbol(pair.quote, pair.base, true)
    }

    /**
     * @param {Asset} base - base asset
     * @param {Asset} quote - quote asset
     * @param {boolean} [inversed] - is pair inversed
     * @returns {string|null}
     */
    __getSymbol(base, quote, inversed = false) {
        for (const alias of base.alias) { //TODO: optimize this function
            for (const quoteAlias of quote.alias) {
                const symbol = this.__formatSymbol(alias, quoteAlias)
                if (this.markets.includes(symbol))
                    return {symbol, inversed}
            }
        }
        return null
    }

    /**
     * @param {string} base - base asset symbol alias
     * @param {string} quote - quote asset symbol alias
     * @returns {string}
     * @protected
     */
    __formatSymbol(base, quote) {
        return `${base.toUpperCase()}${quote.toUpperCase()}`
    }

    /**
     * Walks the routes for one request. With gateways configured the walk never ends in a direct request: a direct
     * request would show the node's ip to the upstream, so when every gateway route fails the request fails and the
     * tick loses this provider's data. The direct route is walked only when it is a route in its own right - no
     * gateways configured, or `useCurrentProvider` chose the local host.
     * @param {string} url - request url
     * @param {any} [options] - axios request options
     * @returns {Promise<any>} axios response with a 2xx status
     * @throws {RequestError} the last failure when every route failed, the first deterministic one, or
     * `ERR_NO_GATEWAY` when the gateways are configured and none of them is usable
     * @protected
     */
    async __makeRequest(url, options = {}) {
        let host
        try {
            host = new URL(url).host
        } catch (e) {
            throw new RequestError('invalid-url', {code: 'ERR_INVALID_URL'})
        }
        const routes = PriceProviderBase.getRoutes(url)
        if (routes.length === 0) //fail closed before any transport call; setGateway already logged why
            throw new RequestError(host, {code: RequestError.noRouteCode})
        let lastError = null
        for (const gatewayUrl of routes) {
            try {
                return await PriceProviderBase.sendRequest(url, options, gatewayUrl)
            } catch (error) {
                lastError = error
                //both urls are parsed before the walk starts, so ERR_INVALID_URL here can only come from composing the
                //gateway url: that is a broken route, not an upstream verdict, so keep walking instead of breaking
                const routeBroken = gatewayUrl !== undefined && error.code === 'ERR_INVALID_URL'
                if (!routeBroken && !error.retryable)
                    break
            }
        }
        throw lastError
    }

    /**
     * @param {number} targetTimestamp - target timestamp
     * @param {number[]} timestamps - timestamps to validate in descending order
     * @param {number} timeframe - timeframe in seconds
     * @protected
     */
    __validateTimestamps(targetTimestamp, timestamps, timeframe) {
        for (let i = 0; i < timestamps.length; i++) {
            const actualTimestamp = timestamps[i]
            if (actualTimestamp !== targetTimestamp)
                throw new Error(`Timestamp mismatch: ${actualTimestamp} !== ${targetTimestamp}`)
            targetTimestamp = targetTimestamp + timeframe
        }
    }
}

module.exports = PriceProviderBase