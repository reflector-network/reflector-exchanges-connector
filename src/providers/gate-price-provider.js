const OHLCV = require('../models/ohlcv')
const PriceProviderBase = require('./price-provider-base')

const baseUrl = 'https://api.gateio.ws/api/v4'

class GatePriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'gate'

    async __loadMarkets() {
        const marketsUrl = `${baseUrl}/spot/currency_pairs`
        const response = await this.__makeRequest(marketsUrl)
        const markets = response.data
        return markets
            .filter(market => market.trade_status.toUpperCase() === 'TRADABLE')
            .map(market => market.id)
    }

    async __getOHLCV(pair, timestamp, timeframe, decimals) {
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return null
        const klinesUrl = `${baseUrl}/spot/candlesticks?currency_pair=${symbolInfo.symbol}&interval=${timeframe}m&from=${timestamp}&limit=1`
        const response = await this.__makeRequest(klinesUrl)
        const klines = response.data
        if (klines.length === 0)
            return null
        const kline = klines[0]
        this.validateTimestamp(timestamp, kline[0])
        return new OHLCV({
            open: kline[5],
            high: kline[3],
            low: kline[4],
            close: kline[2],
            volume: kline[6],
            quoteVolume: kline[1],
            inversed: symbolInfo.inversed,
            source: this.name,
            decimals,
            completed: kline[7].toUpperCase() === 'TRUE'
        })
    }

    __formatSymbol(base, quote) {
        return `${quote}_${base}`
    }
}

module.exports = GatePriceProvider