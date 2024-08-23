const TradeData = require('../models/trade-data')
const PriceProviderBase = require('./price-provider-base')

const baseApiUrl = 'https://api.kraken.com/0'

class KrakenPriceProvider extends PriceProviderBase {
    constructor(apiKey, secret) {
        super(apiKey, secret)
    }

    name = 'kraken'

    async __loadMarkets(timeout) {
        const marketsUrl = `${baseApiUrl}/public/AssetPairs`
        const response = await this.__makeRequest(marketsUrl, {timeout})
        const markets = response.data.result
        return Object.keys(markets)
            .filter(market => markets[market].status.toUpperCase() === 'ONLINE')
            .map(market => markets[market].altname)
    }

    async __getTradeData(pair, timestamp, timeframe, count, timeout) {
        const symbolInfo = this.getSymbolInfo(pair)
        const timeframeSeconds = timeframe * 60
        const to = timestamp + timeframeSeconds * count
        //since is exclusive, so we need to subtract a second to get the kline that matches the timestamp
        const klinesUrl = `${baseApiUrl}/public/OHLC?pair=${symbolInfo.symbol}&interval=${timeframe}&since=${timestamp - 1}`
        const response = await this.__makeRequest(klinesUrl, {timeout})

        //Kraken API returns an object with the last and the pair name. Pair name is not always the same as the symbol
        const klines = response.data.result[Object.keys(response.data.result).filter(k => k !== 'last')[0]]
            //Kraken API doesn't have limit=1, so we need to filter the klines
            .filter(kline => kline[0] >= timestamp && kline[0] < to)

        return this.__processKlines(klines, timestamp, symbolInfo.inversed, timeframe, count)

    }

    __processSingleKline(kline, inversed) {
        return new TradeData({
            ts: Number(kline[0]),
            volume: kline[6],
            quoteVolume: Number(kline[5]) * Number(kline[6]), //volume * vwap
            inversed,
            source: this.name,
            completed: true //there is no indicator to determine if the candle is closed
        })
    }

    __formatSymbol(base, quote) {
        return `${quote}${base}`
    }
}

module.exports = KrakenPriceProvider