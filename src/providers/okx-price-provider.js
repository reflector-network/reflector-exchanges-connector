const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://www.okx.com/api/v5'

class OkxPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'okx'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/public/instruments?instType=SPOT`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data.data
        return markets
            .filter(market => market.state.toUpperCase() === 'LIVE')
            .map(market => market.instId)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const timestampInMs = timestamp * 1000
        const timeframeInMs = timeframe * 60000
        const before = timestampInMs - timeframeInMs
        const after = timestampInMs + (count * timeframeInMs)
        const bar = timeframe === 60 ? '1h' : `${timeframe}m`
        //https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
        const klinesUrl = `${baseApiUrl}/market/candles?instId=${symbolInfo.symbol}&bar=${bar}&before=${before}&after=${after}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data.data
        klines.reverse()//okx returns the oldest first
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: Number(kline[0]) / 1000,
            volume: kline[5],
            quoteVolume: kline[7],
            inversed,
            source: this.name,
            completed: kline[8] === '1'
        })
    }

    __formatSymbol(base, quote) {
        return `${quote}-${base}`
    }
}

module.exports = OkxPriceProvider