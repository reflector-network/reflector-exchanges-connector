/*eslint-disable no-undef */
const {getPrices} = require('../src')
const {assets, getTimestamp} = require('./test-utils')


describe('index', () => {
    it('get prices', async () => {
        const prices = await getPrices(assets, 'USD', getTimestamp(), 60, 14, {batchSize: 5, batchDelay: 1000, timeout: 8000, sources: ['binance', 'bybit', 'kraken', 'gate', 'okx', 'coinbase']})
        expect(prices.length).toBe(assets.length)
    }, 30000)
})