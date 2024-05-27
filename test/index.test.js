/*eslint-disable no-undef */
const {getPrices} = require('../src')
const {assets, getTimestamp} = require('./test-utils')


describe('index', () => {
    it('get prices', async () => {
        const prices = await getPrices(assets, 'USD', getTimestamp(), 60, 14)
        expect(prices.length).toBe(assets.length)
    }, 30000)
})