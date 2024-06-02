const OHLCV = require('../models/ohlcv')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://www.okx.com/api/v5'

class OkxPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'okx'

    async __loadMarkets() {
        const marketsUrl = `${baseApiUrl}/public/instruments?instType=SPOT`
        const response = await this.__makeRequest(marketsUrl)
        const markets = response.data.data
        return markets
            .filter(market => market.state.toUpperCase() === 'LIVE')
            .map(market => market.instId)
    }

    async __getOHLCV(pair, timestamp, timeframe, decimals) {
        const symbolInfo = this.getSymbolInfo(pair)
        if (!symbolInfo)
            return null
        timestamp = timestamp * 1000
        const timeframeInMs = timeframe * 60000
        const before = timestamp - timeframeInMs
        const after = timestamp + timeframeInMs
        //https://www.okx.com/docs-v5/en/#order-book-trading-market-data-get-candlesticks
        const klinesUrl = `${baseApiUrl}/market/candles?instId=${symbolInfo.symbol}&bar=${timeframe}m&before=${before}&after=${after}&limit=1`
        console.log(klinesUrl)
        const response = await this.__makeRequest(klinesUrl)
        const klines = response.data.data
        if (klines.length === 0)
            return null
        const kline = klines[0]
        this.validateTimestamp(timestamp, kline[0])
        return new OHLCV({
            open: kline[1],
            high: kline[2],
            low: kline[3],
            close: kline[4],
            volume: kline[5],
            quoteVolume: kline[7],
            inversed: symbolInfo.inversed,
            source: this.name,
            decimals,
            base: pair.base.name,
            quote: pair.quote.name,
            completed: !!kline[8]
        })
    }

    __formatSymbol(base, quote) {
        return `${quote}-${base}`
    }
}

module.exports = OkxPriceProvider