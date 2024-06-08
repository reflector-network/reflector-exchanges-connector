/*eslint-disable no-undef */
const {getPrices, setProxy} = require('../src')
const {assets, getTimestamp} = require('./test-utils')

const proxies = [
]

describe('index', () => {
    prices = []
    const timestamp = getTimestamp()
    it('get prices', async () => {
        prices = await getPrices(assets, 'USD', timestamp, 60, 14, {batchSize: 5, batchDelay: 1000, timeout: 8000, sources: ['binance', 'bybit', 'kraken', 'gate', 'okx', 'coinbase']})
        expect(prices.length).toBe(assets.length)
    }, 30000)


    it('get prices with proxy', async () => {
        setProxy(proxies, true)
        const newPrices = await getPrices(assets, 'USD', timestamp, 60, 14, {batchSize: 10, batchDelay: 1000, timeout: 3000, sources: ['binance', 'bybit', 'kraken', 'gate', 'okx', 'coinbase']})
        expect(newPrices.length).toBe(assets.length)
        setProxy(null)
        expect(newPrices.length).toBe(prices.length)
        for (let i = 0; i < prices.length; i++) {
            expect(newPrices[i]).toBe(prices[i])
        }
    }, 30000)

})