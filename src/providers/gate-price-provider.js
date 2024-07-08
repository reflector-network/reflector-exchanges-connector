const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseUrl = 'https://api.gateio.ws/api/v4'

class GatePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'gate'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseUrl}/spot/currency_pairs`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data
        return markets
            .filter(market => market.trade_status.toUpperCase() === 'TRADABLE')
            .map(market => market.id)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return null

        const timeframeSeconds = timeframe * 60
        const normalizedTimeframe = timeframe === 60 ? '1h' : `${timeframe}m`
        const klinesUrl = `${baseUrl}/spot/candlesticks?currency_pair=${symbolInfo.symbol}&interval=${normalizedTimeframe}&from=${timestamp}&limit=${count}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data
        if (klines.length === 0)
            return null
        const tradesData = []
        const timestamps = []
        for (let i = 0; i < klines.length; i++) {
            const kline = klines[i]
            tradesData.push(new TradeData({
                ts: Number(kline[0]),
                volume: kline[6],
                quoteVolume: kline[1],
                inversed: symbolInfo.inversed,
                source: this.name,
                completed: kline[7].toUpperCase() === 'TRUE'
            }))
            timestamps.push(Number(kline[0]))
        }
        this.validateTimestamps(timestamp, timestamps, timeframeSeconds)
        return tradesData
    }

    __formatSymbol(base, quote) {
        return `${quote}_${base}`
    }
}

module.exports = GatePriceProvider