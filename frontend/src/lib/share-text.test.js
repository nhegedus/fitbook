// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('./mobile.js', () => ({ MOBILE: false }))
vi.mock('./clipboard.js', () => ({ copyText: vi.fn(async () => true) }))
import { copyText } from './clipboard.js'
import { shareText } from './share-text.js'

describe('shareText (web)', () => {
  let saved
  beforeEach(() => { saved = navigator.share; copyText.mockClear() })
  afterEach(() => { navigator.share = saved })
  it('uses the browser share sheet when there is one', async () => {
    navigator.share = vi.fn(async () => {})
    expect(await shareText('hello', 'Mic dejun')).toBe('shared')
    expect(navigator.share).toHaveBeenCalledWith({ title: 'Mic dejun', text: 'hello' })
    expect(copyText).not.toHaveBeenCalled()
  })
  it('does nothing more when the user closes the share sheet', async () => {
    navigator.share = vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'AbortError' }) })
    expect(await shareText('hello', 'x')).toBe('dismissed')
    expect(copyText).not.toHaveBeenCalled()
  })
  it('copies instead when sharing fails or does not exist', async () => {
    navigator.share = vi.fn(async () => { throw new Error('NotAllowed') })
    expect(await shareText('hello', 'x')).toBe('copied')
    navigator.share = undefined
    expect(await shareText('hi', 'x')).toBe('copied')
    expect(copyText).toHaveBeenLastCalledWith('hi')
  })
  it('reports a copy that did not work', async () => {
    navigator.share = undefined
    copyText.mockResolvedValueOnce(false)
    expect(await shareText('hello', 'x')).toBe('failed')
  })
})
