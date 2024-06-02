/*eslint-disable no-undef */
const OkxPriceProvider = require('../src/providers/okx-price-provider')
const {getPriceTest, loadMarkets, pairs} = require('./test-utils')

const provider = new OkxPriceProvider()

describe('OkxPriceProvider', () => {
    it('load markets', async () => {
        await loadMarkets(provider)
    }, 10000)

    it('get price', async () => {
        await getPriceTest(provider, pairs.normalPair)
    })

    it('get price for inverted pair', async () => {
        await getPriceTest(provider, pairs.invertedPair)
    })

    it('get price for invalid pair', async () => {
        await getPriceTest(provider, pairs.invalidPair, true)
    })
})