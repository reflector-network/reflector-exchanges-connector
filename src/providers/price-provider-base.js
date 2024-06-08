/*eslint-disable class-methods-use-this */
const https = require('https')
const http = require('http')
const {default: axios} = require('axios')
const {SocksProxyAgent} = require('socks-proxy-agent')
const OHLCV = require('../models/ohlcv')
const {getBigIntPrice} = require('../price-utils')

const defaultAgentOptions = {keepAlive: true, maxSockets: 50, noDelay: true}

const requestedUrls = new Map()

const httpAgent = new http.Agent(defaultAgentOptions)
axios.defaults.httpAgent = httpAgent

const httpsAgent = new https.Agent(defaultAgentOptions)
axios.defaults.httpsAgent = httpsAgent

function createProxyAgent(proxyConnectionString) {
    if (!proxyConnectionString)
        return null
    if (!proxyConnectionString || !proxyConnectionString.startsWith('socks'))
        throw new Error(`Invalid proxy uri ${proxyConnectionString}`)
    const socksAgent = new SocksProxyAgent(proxyConnectionString, defaultAgentOptions)
    return socksAgent
}

function getRotatedIndex(index, length) {
    return (index + 1) % length
}

function getRandomIndex(length, currentIndex) {
    let newIndex = Math.floor(Math.random() * length)
    if (newIndex === currentIndex)
        newIndex = getRotatedIndex(newIndex, length)
    return newIndex
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

    static setProxy(proxyConnectionSting, useCurrentProvider) {
        if (!proxyConnectionSting) {
            PriceProviderBase.proxyAgents = null
            return
        }

        const proxies = []
        if (!Array.isArray(proxyConnectionSting))
            proxyConnectionSting = [proxyConnectionSting]

        for (const p of proxyConnectionSting) {
            try {
                proxies.push(createProxyAgent(p))
            } catch (e) {
                console.error(e)
            }
        }
        if (proxies.length === 0) {
            PriceProviderBase.proxyAgents = null
            return
        }

        if (useCurrentProvider) //add current server
            proxies.unshift(undefined)

        PriceProviderBase.proxyAgents = proxies
    }

    static getProxyAgent(url) {
        if (!PriceProviderBase.proxyAgents) //no proxies
            return undefined

        if (PriceProviderBase.proxyAgents.length === 1) //single proxy, no need to rotate
            return PriceProviderBase.proxyAgents[0]

        //try to get proxy index for url
        const index = getRandomIndex(PriceProviderBase.proxyAgents.length, requestedUrls.get(url))

        //set proxy index for url
        PriceProviderBase.setRequestedUrl(url, index)
        return PriceProviderBase.proxyAgents[index]
    }

    static setRequestedUrl(url, proxyIndex) {
        //if url is already errored, update proxyIndex
        if (requestedUrls.has(url)) {
            requestedUrls.set(url, proxyIndex)
            return
        }
        //add url to requestedUrls
        requestedUrls.set(url, proxyIndex)
        if (requestedUrls.size > 1000) { //remove first key if size is more than 1000
            const firstKey = requestedUrls.keys().next().value
            PriceProviderBase.deleteRequestedUrl(firstKey)
        }
    }

    static deleteRequestedUrl(url) {
        requestedUrls.delete(url)
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
     * @returns {Promise<Array<string>>} Returns supported symbols
     * @abstract
     * @protected
     */
    __loadMarkets(timeout) {
        throw new Error('Not implemented')
    }


    /**
     * @param {Pair} pair - pair to get price for
     * @param {number} timestamp - timestamp in milliseconds
     * @param {number} timeframe - timeframe in minutes
     * @param {number} decimals - number of decimals for the price
     * @param {number} [timeout] - request timeout in milliseconds. Default is 3000ms
     * @returns {Promise<number>}
     */
    async getPrice(pair, timestamp, timeframe, decimals, timeout = 3000) {
        const ohlcv = await this.getOHLCV(pair, timestamp, timeframe, decimals, timeout)
        if (!ohlcv)
            return null
        return ohlcv.price()
    }

    /**
     *
     * @param {Pair} pair - pair to get OHLCV for
     * @param {number} timestamp - timestamp in seconds
     * @param {number} timeframe - timeframe in minutes
     * @param {number} decimals - number of decimals for the price
     * @param {number} [timeout] - request timeout in milliseconds. Default is 3000ms
     * @returns {Promise<OHLCV|null>}
     */
    getOHLCV(pair, timestamp, timeframe, decimals, timeout = 3000) {
        if (pair.base.name === pair.quote.name) {
            const price = getBigIntPrice(1, decimals)
            return new OHLCV({
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 0,
                quoteVolume: 0,
                inversed: false,
                source: this.name,
                base: pair.base.name,
                quote: pair.quote.name,
                decimals
            })
        }
        return this.__getOHLCV(pair, timestamp, timeframe, decimals, timeout)
    }

    /**
     * @param {Pair} pair
     * @param {number} timestamp
     * @param {number} timeframe
     * @param {number} decimals
     * @param {number} timeout
     * @abstract
     * @protected
     */
    __getOHLCV(pair, timestamp, timeframe, decimals, timeout) {
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
     * @param {Asset} base
     * @param {Asset} quote
     * @param {boolean} [inversed]
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
     * @param {string} base
     * @param {string} quote
     * @returns {string}
     * @protected
     */
    __formatSymbol(base, quote) {
        return `${quote.toUpperCase()}${base.toUpperCase()}`
    }

    /**
     * @param {string} url - request url
     * @param {any} [options] - request options
     * @returns {Promise<any>}
     * @protected
     */
    async __makeRequest(url, options = {}) {
        const requestOptions = {
            ...options,
            url
        }
        requestOptions.httpAgent = requestOptions.httpsAgent = PriceProviderBase.getProxyAgent(url)
        const start = Date.now()
        const response = await axios.request(requestOptions)
        const time = Date.now() - start
        PriceProviderBase.deleteRequestedUrl(url)
        console.debug(`Request to ${url} took ${time}ms. Proxy: ${requestOptions.httpAgent ? `${requestOptions.httpAgent.proxy.host}:${requestOptions.httpAgent.proxy.port}` : 'no'}`)
        return response
    }

    /**
     * @param {number} expectedTimestamp
     * @param {number} actualTimestamp
     * @protected
     */
    validateTimestamp(expectedTimestamp, actualTimestamp) {
        if (expectedTimestamp.toString() !== actualTimestamp?.toString())
            throw new Error(`Timestamp mismatch: ${actualTimestamp} !== ${expectedTimestamp}`)
    }
}

module.exports = PriceProviderBase