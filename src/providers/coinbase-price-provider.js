const OHLCV = require('../models/ohlcv')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.exchange.coinbase.com'

class CoinbasePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'coinbase'

    async __loadMarkets() {
        const marketsUrl = `${baseApiUrl}/products`
        const response = await this.__makeRequest(marketsUrl)
        const markets = response.data
        return markets
            .filter(market => market.status.toUpperCase() === 'ONLINE')
            .map(market => market.id)
    }

    async __getOHLCV(pair, timestamp, timeframe, decimals) {
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return null
        const klinesUrl = `${baseApiUrl}/products/${symbolInfo.symbol}/candles?granularity=${timeframe}m&start=${timestamp}&end=${timestamp}`
        const response = await this.__makeRequest(klinesUrl)
        const klines = response.data
        if (klines.length === 0)
            return null
        const kline = klines[0]
        this.validateTimestamp(timestamp, kline[0])
        const ohlcv = {
            open: kline[3],
            high: kline[2],
            low: kline[1],
            close: kline[4],
            volume: kline[5],
            inversed: symbolInfo.inversed,
            source: this.name,
            decimals,
            base: pair.base.name,
            quote: pair.quote.name,
            completed: true //there is indicator to determine if the candle is closed
        }
        ohlcv.quoteVolume = Number(ohlcv.volume) * ((ohlcv.close + ohlcv.open + ohlcv.high + ohlcv.low) / 4)
        return new OHLCV(ohlcv)
    }

    __formatSymbol(base, quote) {
        return `${quote}-${base}`
    }
}

module.exports = CoinbasePriceProvider