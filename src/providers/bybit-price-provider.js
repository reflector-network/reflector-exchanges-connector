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
        const klinesUrl = `${baseApiUrl}/market/kline?category=spot&symbol=${symbolInfo.symbol}&interval=${timeframe}&start=${timestamp * 1000}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data.result.list
        klines.reverse()//bybit returns the oldest first
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: Number(kline[0]) / 1000,
            volume: kline[5],
            quoteVolume: kline[6],
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }
}

module.exports = BybitPriceProvider