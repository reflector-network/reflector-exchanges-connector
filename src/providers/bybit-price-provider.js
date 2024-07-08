const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.bybit.com/v5'

class BybitPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'bybit'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/market/instruments-info?category=spot`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data.result.list
        return markets
            .filter(market => market.status.toUpperCase() === 'TRADING')
            .map(market => market.symbol)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return null
        timestamp = timestamp * 1000
        const timeframeMs = timeframe * 60 * 1000
        const klinesUrl = `${baseApiUrl}/market/kline?category=spot&symbol=${symbolInfo.symbol}&interval=${timeframe}&start=${timestamp}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data.result.list
        if (klines.length === 0)
            return null
        const tradesData = []
        const timestamps = []
        //bybit returns candles in descending order, so reverse the array
        for (let i = klines.length - 1; i >= 0; i--) {
            const kline = klines[i]
            tradesData.push(new TradeData({
                ts: Number(kline[0]) / 1000,
                volume: kline[5],
                quoteVolume: kline[6],
                inversed: symbolInfo.inversed,
                source: this.name,
                completed: true //there is no indicator to determine if the candle is closed
            }))
            timestamps.push(Number(kline[0]))
        }
        this.validateTimestamps(timestamp, timestamps, timeframeMs)
        return tradesData
    }
}

module.exports = BybitPriceProvider