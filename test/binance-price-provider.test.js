/*eslint-disable no-undef */
const BinancePriceProvider = require('../src/providers/binance-price-provider')
const {getPriceTest, loadMarkets, pairs} = require('./test-utils')

const provider = new BinancePriceProvider()

describe('BinancePriceProvider', () => {
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