import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder as cmPlaceholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext } from '@codemirror/autocomplete'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { tags as t } from '@lezer/highlight'

/** Autocompletado de la API que expone el kernel (simon.*) y atajos comunes del laboratorio. */
const SIMON_API = [
  { label: 'data', detail: 'simon.data(hours=None)', info: 'DataFrame con las lecturas reales del dispositivo.', apply: 'data()' },
  { label: 'log', detail: 'simon.log(paso, **métricas)', info: 'Registra métricas y las dibuja como curva de aprendizaje.', apply: 'log(epoca, perdida=, validacion=)' },
  { label: 'alert', detail: "simon.alert(nivel, mensaje)", info: "Emite una alerta: 'info', 'warn' o 'critical'.", apply: "alert('warn', '')" },
  { label: 'register', detail: '@simon.register', info: 'Registra predict(row) para usarlo con la última lectura o en vivo.' },
]

function simonCompletions(ctx: CompletionContext) {
  const dotted = ctx.matchBefore(/simon\.\w*/)
  if (dotted) {
    return { from: dotted.from + 6, options: SIMON_API.map((o) => ({ ...o, type: 'method' })), validFor: /^\w*$/ }
  }
  const word = ctx.matchBefore(/\w+/)
  if (!word || (word.from === word.to && !ctx.explicit)) return null
  return {
    from: word.from,
    options: [
      { label: 'simon', type: 'namespace', detail: 'API del laboratorio' },
      { label: 'predict', type: 'function', detail: 'def predict(row): …', apply: 'def predict(row):\n    ' },
      { label: 'train', type: 'function', detail: 'def train(df): …', apply: 'def train(df):\n    ' },
    ],
    validFor: /^\w*$/,
  }
}

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--a-code)', color: 'var(--a-code-ink)', fontSize: '13px', borderRadius: '10px', maxHeight: '620px' },
  '&.cm-focused': { outline: '2px solid var(--a-focus)', outlineOffset: '1px' },
  '.cm-scroller': { fontFamily: MONO, lineHeight: '1.6', overflow: 'auto' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--a-code-ink)' },
  '.cm-line': { padding: '0 12px 0 6px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: '#5f7a69', border: 'none', paddingLeft: '4px' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,.045)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a9c7b3' },
  '.cm-cursor': { borderLeftColor: 'var(--a-code-ink)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(95,208,138,.28) !important' },
  '.cm-placeholder': { color: '#5f7a69' },
  '.cm-tooltip': { backgroundColor: 'var(--a-surface)', color: 'var(--a-ink)', border: '1px solid var(--a-line)', borderRadius: '8px', overflow: 'hidden' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--a-accent)', color: 'var(--a-accent-ink)' },
  '.cm-completionDetail': { opacity: 0.75, marginLeft: '8px' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(95,208,138,.25)', outline: 'none' },
})

const markdownTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--a-raised)', color: 'var(--a-ink)', fontSize: '14px' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--a-ink)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-cursor': { borderLeftColor: 'var(--a-ink)' },
})

const codeHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: '#c792ea' },
  { tag: [t.string, t.special(t.string)], color: '#a5e075' },
  { tag: [t.number, t.bool, t.null], color: '#f78c6c' },
  { tag: [t.comment, t.lineComment], color: '#6b8a76', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: '#82aaff' },
  { tag: [t.className, t.typeName], color: '#ffcb6b' },
  { tag: [t.propertyName, t.attributeName], color: '#89ddff' },
  { tag: [t.operator, t.punctuation], color: '#9fb8a8' },
  { tag: t.self, color: '#f07178' },
  { tag: t.meta, color: '#ffcb6b' },
])

const mdHighlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--a-accent)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--a-accent)', textDecoration: 'underline' },
  { tag: t.monospace, fontFamily: MONO, color: 'var(--a-accent)' },
  { tag: t.quote, color: 'var(--a-muted)', fontStyle: 'italic' },
  { tag: t.processingInstruction, color: 'var(--a-muted)' },
])

interface Props {
  value: string
  onChange: (v: string) => void
  language?: 'python' | 'markdown'
  placeholder?: string
  /** Mayús+Enter → advance=true (ejecuta y pasa a la siguiente); Ctrl/Cmd+Enter → advance=false. */
  onRun?: (advance: boolean) => void
  onFocus?: () => void
  ariaLabel?: string
  autoFocus?: boolean
  /** Para volver a enfocar la celda siguiente desde fuera. */
  registerFocus?: (focus: (() => void) | null) => void
}

export function CodeEditor({ value, onChange, language = 'python', placeholder, onRun, onFocus, ariaLabel, autoFocus, registerFocus }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef({ onChange, onRun, onFocus })
  cb.current = { onChange, onRun, onFocus }

  useEffect(() => {
    if (!host.current) return
    const md = language === 'markdown'
    const state = EditorState.create({
      doc: value,
      extensions: [
        md ? [markdownTheme, syntaxHighlighting(mdHighlight)] : [lineNumbers(), highlightActiveLineGutter(), syntaxHighlighting(codeHighlight)],
        theme,
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        indentUnit.of('    '),
        EditorView.lineWrapping,
        md ? markdown() : [python(), autocompletion({ override: [simonCompletions], icons: false })],
        placeholder ? cmPlaceholder(placeholder) : [],
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? (md ? 'Nota' : 'Código') }),
        keymap.of([
          { key: 'Shift-Enter', run: () => (cb.current.onRun ? (cb.current.onRun(true), true) : false) },
          { key: 'Mod-Enter', run: () => (cb.current.onRun ? (cb.current.onRun(false), true) : false) },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString())
          if (u.focusChanged && u.view.hasFocus) cb.current.onFocus?.()
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    registerFocus?.(() => v.focus())
    if (autoFocus) v.focus()
    return () => {
      registerFocus?.(null)
      v.destroy()
      view.current = null
    }
    // El editor se crea una sola vez por celda; los cambios de `value` se sincronizan abajo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])

  return <div className={'cm-host ' + language} ref={host} />
}
