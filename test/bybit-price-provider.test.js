/*eslint-disable no-undef */
const BybitPriceProvider = require('../src/providers/bybit-price-provider')
const {getPriceTest, pairs, loadMarkets} = require('./test-utils')

const provider = new BybitPriceProvider()

describe('BybitPriceProvider', () => {
    it('load markets', async () => {
        await loadMarkets(provider)
    })

    it('get price', async () => {
        await getPriceTest(provider, pairs.pairs[0])
    })

    it('get price for inverted pair', async () => {
        await getPriceTest(provider, pairs.invertedPair)
    })

    it('get price for invalid pair', async () => {
        await getPriceTest(provider, pairs.invalidPair, true)
    })
})