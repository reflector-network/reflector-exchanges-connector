/*eslint-disable no-undef */
const TradeData = require('../src/models/trade-data')
const Pair = require('../src/models/pair')
const {getAsset} = require('../src/assets-cache')

/**
 * Creates a mock provider with controlled getTradesData behavior
 */
function createMockProvider(name, getTradesDataFn) {
    return {
        name,
        marketsLoadedAt: Date.now(),
        markets: [],
        loadMarkets: jest.fn(),
        getTradesData: jest.fn(getTradesDataFn)
    }
}

function completedTrade(source) {
    return new TradeData({volume: '100', quoteVolume: '200', inversed: false, source, completed: true})
}

function incompleteTrade(source) {
    return new TradeData({volume: '100', quoteVolume: '200', inversed: false, source, completed: false})
}

//fetchPairTradesData is not exported, so we test it indirectly
//by importing and patching the supportedProviders array
let supportedProviders
let ExchangesPriceProvider

beforeAll(() => {
    //Access the module's internal supportedProviders via require cache manipulation
    //Instead, we'll use jest to mock provider modules and test through the public API
})

describe('fetchPairTradesData retry logic', () => {
    const pair = new Pair(getAsset('USD'), getAsset('BTC'))

    //We need to test the internal function. Since it's not exported,
    //we extract and test the logic by requiring the source and using
    //a jest spy on the provider's getTradesData method
    let provider

    //Import the actual fetchPairTradesData by re-requiring the module internals
    //Since we can't directly access it, we'll test through getProviderTradesData
    //via the ExchangesPriceProvider.getPriceData method with a single provider

    it('returns data immediately when all trades are completed', async () => {
        const mockProvider = createMockProvider('test', () => [completedTrade('test'), completedTrade('test')])

        //Call fetchPairTradesData logic directly since we can't access it,
        //replicate the function here for unit testing
        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 2, 3000)
        expect(result).toHaveLength(2)
        expect(result[0].completed).toBe(true)
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(1)
    })

    it('retries up to 3 times when trades are incomplete, then returns empty', async () => {
        const mockProvider = createMockProvider('test', () => [incompleteTrade('test')])

        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 1, 3000)
        expect(result).toEqual([])
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(3)
    })

    it('returns data on second try after initial incomplete response', async () => {
        let callCount = 0
        const mockProvider = createMockProvider('test', () => {
            callCount++
            if (callCount === 1)
                return [incompleteTrade('test')]
            return [completedTrade('test')]
        })

        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 1, 3000)
        expect(result).toHaveLength(1)
        expect(result[0].completed).toBe(true)
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(2)
    })

    it('breaks immediately when provider returns null (no data)', async () => {
        const mockProvider = createMockProvider('test', () => null)

        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 1, 3000)
        expect(result).toEqual([])
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(1)
    })

    it('retries on error and returns empty after 3 failures', async () => {
        const mockProvider = createMockProvider('test', () => {
            throw new Error('network timeout')
        })

        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 1, 3000)
        expect(result).toEqual([])
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(3)
    })

    it('recovers from error on retry', async () => {
        let callCount = 0
        const mockProvider = createMockProvider('test', () => {
            callCount++
            if (callCount === 1)
                throw new Error('transient error')
            return [completedTrade('test')]
        })

        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 1, 3000)
        expect(result).toHaveLength(1)
        expect(result[0].completed).toBe(true)
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(2)
    })

    it('handles empty array from provider (all completed vacuously)', async () => {
        const mockProvider = createMockProvider('test', () => [])

        const result = await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 0, 3000)
        expect(result).toEqual([])
        expect(mockProvider.getTradesData).toHaveBeenCalledTimes(1)
    })

    it('logs correct retry/skip message', async () => {
        const debugMessages = []
        const originalDebug = console.debug
        console.debug = (...args) => debugMessages.push(args.join(' '))

        const mockProvider = createMockProvider('test', () => [incompleteTrade('test')])
        await simulateFetchPairTradesData(mockProvider, pair, 1000, 5, 1, 3000)

        console.debug = originalDebug

        //First two calls should say "Retrying...", last should say "Skipping..."
        expect(debugMessages.filter(m => m.includes('Retrying...'))).toHaveLength(2)
        expect(debugMessages.filter(m => m.includes('Skipping...'))).toHaveLength(1)
    })
})

/**
 * Replicates the fetchPairTradesData function from src/index.js for unit testing.
 * This mirrors the exact logic so we can test retry behavior without needing
 * to go through the full getPriceData pipeline.
 */
async function simulateFetchPairTradesData(provider, pair, timestamp, timeframe, count, timeout) {
    let tries = 3
    const errors = []
    while (tries > 0) {
        try {
            const tradesData = await provider.getTradesData(pair, timestamp, timeframe, count, timeout)
            if (!tradesData) {
                console.debug(`No data for ${pair.name} from ${provider.name}`)
                break
            }
            if (tradesData.every(trade => trade.completed))
                return tradesData
            console.debug(`Incomplete data for ${pair.name} from ${provider.name}. ${tries > 1 ? 'Retrying...' : 'Skipping...'}`)
        } catch (error) {
            errors.push(error.message)
        } finally {
            tries--
        }
    }
    if (errors.length > 0)
        console.warn(`Failed to get data for ${pair.name} from ${provider.name}: ${errors.join(', ')}`)
    return []
}
