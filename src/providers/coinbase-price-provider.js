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
        const timeframeSeconds = timeframe * 60
        const end = timestamp + ((count - 1) * timeframeSeconds) //end is inclusive, so we need to subtract 1
        const klinesUrl = `${baseApiUrl}/products/${symbolInfo.symbol}/candles?granularity=${timeframe}m&start=${timestamp}&end=${end}`
        const response = await this.__makeRequest(klinesUrl, {timeout})
        const klines = response.data
        klines.reverse()//coinbase returns the oldest first
        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)
    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: kline[0],
            volume: kline[5],
            quoteVolume: kline[5] * ((kline[4] + kline[3] + kline[2] + kline[1]) / 4), //volume * average price
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${base}-${quote}`
    }
}

module.exports = CoinbasePriceProvider