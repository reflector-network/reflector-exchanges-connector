const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.exchange.coinbase.com'

class CoinbasePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'coinbase'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/products`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data
        return markets
            .filter(market => market.status.toUpperCase() === 'ONLINE')
            .map(market => market.id)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return null

        const timeframeSeconds = timeframe * 60
        const end = timestamp + ((count - 1) * timeframeSeconds) //end is inclusive, so we need to subtract 1
        const klinesUrl = `${baseApiUrl}/products/${symbolInfo.symbol}/candles?granularity=${timeframe}m&start=${timestamp}&end=${end}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data
        if (klines.length === 0)
            return null
        const tradesData = []
        const timestamps = []
        let currentTimestamp = timestamp
        for (let i = klines.length - 1; i >= 0; i--) {
            const kline = klines[i]
            while (kline[0] !== currentTimestamp) { //if not trades happened, the timestamp will be empty
                tradesData.push(new TradeData({
                    ts: currentTimestamp,
                    volume: 0,
                    quoteVolume: 0,
                    inversed: symbolInfo.inversed,
                    source: this.name,
                    completed: true
                }))
                timestamps.push(currentTimestamp)
                currentTimestamp += timeframeSeconds
            }
            tradesData.push(new TradeData({
                ts: kline[0],
                volume: kline[5],
                quoteVolume: kline[5] * ((kline[4] + kline[3] + kline[2] + kline[1]) / 4), //volume * average price
                inversed: symbolInfo.inversed,
                source: this.name,
                completed: true //there is no indicator to determine if the candle is closed
            }))
            currentTimestamp += timeframeSeconds
            timestamps.push(kline[0])
        }
        this.validateTimestamps(timestamp, timestamps, timeframeSeconds)
        return tradesData
    }

    __formatSymbol(base, quote) {
        return `${quote}-${base}`
    }
}

module.exports = CoinbasePriceProvider