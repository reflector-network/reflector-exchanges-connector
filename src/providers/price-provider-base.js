/*eslint-disable class-methods-use-this */
const https = require('https')
const http = require('http')
const {default: axios} = require('axios')
const TradeData = require('../models/trade-data')

const defaultAgentOptions = {keepAlive: true, maxSockets: 50, noDelay: true}

const requestedUrls = new Map()

const httpAgent = new http.Agent(defaultAgentOptions)
axios.defaults.httpAgent = httpAgent

const httpsAgent = new https.Agent(defaultAgentOptions)
axios.defaults.httpsAgent = httpsAgent

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

    static setProxy(proxyConnectionSting, validationKey, useCurrentProvider) {
        if (!proxyConnectionSting) {
            PriceProviderBase.proxyUrls = null
            PriceProviderBase.validationKey = null
            return
        }

        if (!Array.isArray(proxyConnectionSting))
            proxyConnectionSting = [proxyConnectionSting]

        const proxies = proxyConnectionSting

        if (proxies.length === 0) {
            PriceProviderBase.proxyUrls = null
            PriceProviderBase.validationKey = null
            return
        }

        if (useCurrentProvider) //add current server
            proxies.unshift(undefined)

        PriceProviderBase.proxyUrls = proxies
        PriceProviderBase.validationKey = validationKey
    }

    static getProxyUrl(url) {
        if (!PriceProviderBase.proxyUrls) //no proxies
            return undefined

        if (PriceProviderBase.proxyUrls.length === 1) //single proxy, no need to rotate
            return PriceProviderBase.proxyUrls[0]

        //try to get proxy index for url
        const index = getRandomIndex(PriceProviderBase.proxyUrls.length, requestedUrls.get(url))

        //set proxy index for url
        PriceProviderBase.setRequestedUrl(url, index)
        return PriceProviderBase.proxyUrls[index]
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
     * @param {Pair} pair
     * @param {number} timestamp
     * @param {number} timeframe
     * @param {number} count
     * @param {number} timeout
     * @abstract
     * @protected
     */
    __getTradeData(pair, timestamp, timeframe, count, timeout) {
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
        const proxyUrl = PriceProviderBase.getProxyUrl(url)
        if (proxyUrl) {
            url = `${proxyUrl}/proxy?url=${encodeURIComponent(url)}`
            //add validation key
            if (!options)
                options = {}
            options.headers = {
                ...options.headers,
                'x-proxy-validation': PriceProviderBase.validationKey
            }
        }
        const requestOptions = {
            ...options,
            url
        }
        try {
            const start = Date.now()
            const response = await axios.request(requestOptions)
            const time = Date.now() - start
            PriceProviderBase.deleteRequestedUrl(url)
            if (time > 1000)
                console.debug(`Request to ${url} took ${time}ms. Proxy: ${proxyUrl ? proxyUrl : 'no'}`)
            return response
        } catch (err) {
            console.error(`Request to ${url} failed: ${err.message}. Proxy: ${proxyUrl ? proxyUrl : 'no'}`)
            return null
        }
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