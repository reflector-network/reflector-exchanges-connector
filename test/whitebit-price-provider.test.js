/*eslint-disable no-undef */
const WhitebitPriceProvider = require('../src/providers/whitebit-price-provider')
const {getPriceTest, loadMarkets, pairs} = require('./test-utils')

const provider = new WhitebitPriceProvider()

describe('WhitebitPriceProvider', () => {
    it('load markets', async () => {
        await loadMarkets(provider)
    })

    it('get price', async () => {
        await getPriceTest(provider, pairs.normalPair)
    })

    it('get price for inverted pair', async () => {
        await getPriceTest(provider, pairs.invertedPair)
    })

    it('get price for invalid pair', async () => {
        await getPriceTest(provider, pairs.invalidPair, 5, true)
    })
})