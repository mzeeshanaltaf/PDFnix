import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COLORS, isMarkupTool, useTools } from './tools'

describe('tools store', () => {
  beforeEach(() => {
    useTools.setState({ activeTool: 'select', colors: DEFAULT_COLORS, editing: null })
  })

  it('starts with Select and a colour for every annotation tool', () => {
    const state = useTools.getState()
    expect(state.activeTool).toBe('select')
    expect(Object.keys(state.colors).sort()).toEqual([
      'highlight',
      'note',
      'strikeout',
      'underline'
    ])
  })

  it('knows which tools mark text', () => {
    expect(
      isMarkupTool('highlight') && isMarkupTool('underline') && isMarkupTool('strikeout')
    ).toBe(true)
    expect(isMarkupTool('note')).toBe(false)
    expect(isMarkupTool('select')).toBe(false)
  })

  it('keeps a colour per tool', () => {
    useTools.getState().setColor('underline', '#212121')
    expect(useTools.getState().colors).toEqual({ ...DEFAULT_COLORS, underline: '#212121' })
    // The defaults themselves are not touched.
    expect(DEFAULT_COLORS.underline).not.toBe('#212121')
  })

  it('tracks the comment being edited', () => {
    useTools.getState().setEditing({ tabId: 'tab-1', annotId: 7, page: 2 })
    expect(useTools.getState().editing).toEqual({ tabId: 'tab-1', annotId: 7, page: 2 })
    useTools.getState().setEditing(null)
    expect(useTools.getState().editing).toBeNull()
  })
})
