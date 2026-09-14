import * as React from 'react'
import { ChevronLeft, ChevronRight, Pencil, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const TRANSITION_MS = 180

export type QuestionnaireAnswer = Record<string, { answers: string[] }>

export type QuestionnaireQuestion = {
  id: string
  header?: string
  question: string
  options?:
  | readonly {
    value?: string
    label: string
    description: string
    recommended?: boolean
  }[]
  | null
  isSecret?: boolean
}

type Response = { input: string; selectedValue?: string }

export function Questionnaire({
  questions,
  inputPlaceholder,
  onSubmit,
  onCancel,
}: {
  questions: readonly QuestionnaireQuestion[]
  inputPlaceholder: string
  onSubmit: (answers: QuestionnaireAnswer) => Promise<void>
  onCancel?: () => Promise<void>
}) {
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [responses, setResponses] = React.useState<Record<string, Response>>({})
  const [transitioning, setTransitioning] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [dismissed, setDismissed] = React.useState(false)
  const [emptySubmitError, setEmptySubmitError] = React.useState(false)
  const transitionTimer = React.useRef<number | null>(null)
  const activeQuestion = questions[activeIndex]
  const activeResponse = activeQuestion ? responses[activeQuestion.id] : undefined
  const draft = activeResponse?.input ?? ''

  React.useEffect(
    () => () => {
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current)
    },
    [],
  )

  const buildAnswers = React.useCallback(
    (nextResponses: Record<string, Response>): QuestionnaireAnswer =>
      Object.fromEntries(
        questions.map((question) => {
          const response = nextResponses[question.id]
          const value = response?.input.trim() || response?.selectedValue
          return [question.id, { answers: value ? [value] : [] }]
        }),
      ),
    [questions],
  )

  const submitAnswers = React.useCallback(
    async (nextResponses: Record<string, Response>) => {
      setSubmitting(true)
      try {
        await onSubmit(buildAnswers(nextResponses))
      } finally {
        setSubmitting(false)
      }
    },
    [buildAnswers, onSubmit],
  )

  const moveToQuestion = React.useCallback(
    (nextIndex: number) => {
      if (
        transitioning ||
        submitting ||
        nextIndex === activeIndex ||
        nextIndex < 0 ||
        nextIndex >= questions.length
      )
        return
      const showNextQuestion = () => {
        setActiveIndex(nextIndex)
        setEmptySubmitError(false)
        setTransitioning(false)
        transitionTimer.current = null
      }
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) showNextQuestion()
      else {
        setTransitioning(true)
        transitionTimer.current = window.setTimeout(showNextQuestion, TRANSITION_MS)
      }
    },
    [activeIndex, questions.length, submitting, transitioning],
  )

  const saveCurrentInput = React.useCallback(() => {
    if (!activeQuestion) return
    setResponses((current) => {
      const response = current[activeQuestion.id]
      const input = response?.input.trim() ?? ''
      return input ? { ...current, [activeQuestion.id]: { input } } : current
    })
  }, [activeQuestion])

  const selectCurrentOption = React.useCallback(
    (value: string) => {
      if (!activeQuestion || submitting || transitioning) return
      const nextResponses = {
        ...responses,
        [activeQuestion.id]: { input: '', selectedValue: value },
      }
      setResponses(nextResponses)
      setEmptySubmitError(false)
      if (activeIndex === questions.length - 1) void submitAnswers(nextResponses)
      else moveToQuestion(activeIndex + 1)
    },
    [
      activeIndex,
      activeQuestion,
      moveToQuestion,
      questions.length,
      responses,
      submitAnswers,
      submitting,
      transitioning,
    ],
  )

  const skipCurrentQuestion = React.useCallback(() => {
    if (!activeQuestion || submitting || transitioning) return
    const nextResponses = { ...responses, [activeQuestion.id]: { input: '' } }
    setResponses(nextResponses)
    setEmptySubmitError(false)
    if (activeIndex === questions.length - 1) void submitAnswers(nextResponses)
    else moveToQuestion(activeIndex + 1)
  }, [
    activeIndex,
    activeQuestion,
    moveToQuestion,
    questions.length,
    responses,
    submitAnswers,
    submitting,
    transitioning,
  ])

  const submitCurrentInput = React.useCallback(() => {
    if (!activeQuestion || submitting || transitioning) return
    const value = draft.trim()
    if (!value) {
      if (activeIndex === questions.length - 1) setEmptySubmitError(true)
      return
    }
    const nextResponses = { ...responses, [activeQuestion.id]: { input: value } }
    setResponses(nextResponses)
    setEmptySubmitError(false)
    if (activeIndex === questions.length - 1) void submitAnswers(nextResponses)
    else moveToQuestion(activeIndex + 1)
  }, [
    activeIndex,
    activeQuestion,
    draft,
    moveToQuestion,
    questions.length,
    responses,
    submitAnswers,
    submitting,
    transitioning,
  ])

  const moveBackward = React.useCallback(() => {
    if (activeIndex > 0) {
      saveCurrentInput()
      moveToQuestion(activeIndex - 1)
    }
  }, [activeIndex, moveToQuestion, saveCurrentInput])

  const moveForward = React.useCallback(() => {
    if (activeIndex < questions.length - 1) {
      saveCurrentInput()
      moveToQuestion(activeIndex + 1)
    }
  }, [activeIndex, moveToQuestion, questions.length, saveCurrentInput])

  const close = React.useCallback(async () => {
    if (submitting) return
    if (!onCancel) {
      setDismissed(true)
      return
    }
    setSubmitting(true)
    try {
      await onCancel()
    } finally {
      setSubmitting(false)
    }
  }, [onCancel, submitting])

  if (!activeQuestion || dismissed) return null

  return (
    <form
      className="flex w-full flex-col overflow-hidden rounded-3xl border border-app-border bg-app-surface-raised py-2 text-app-text shadow-[0_2px_12px_var(--app-shadow)]"
      onSubmit={(event) => {
        event.preventDefault()
        submitCurrentInput()
      }}
    >
      <div className="flex items-center justify-center gap-3 px-4 pt-4">
        <h2 className="min-w-0 flex-1 text-lg leading-snug font-semibold text-foreground ml-4">
          {activeQuestion.question}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous question"
            className="shrink-0 rounded-full text-muted-foreground"
            onClick={moveBackward}
            disabled={submitting || transitioning || activeIndex === 0}
          >
            <ChevronLeft />
          </Button>
          <p className="text-sm text-muted-foreground">
            {activeIndex + 1} of {questions.length}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next question"
            className="shrink-0 rounded-full text-muted-foreground"
            onClick={moveForward}
            disabled={submitting || transitioning || activeIndex === questions.length - 1}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close questionnaire"
          className="shrink-0 rounded-full text-muted-foreground"
          onClick={() => void close()}
          disabled={submitting}
        >
          <X />
        </Button>
      </div>

      <div
        className={cn(
          'mt-4 flex flex-col gap-2 transition-opacity duration-200 ease-out motion-reduce:transition-none px-2',
          transitioning ? 'opacity-0' : 'opacity-100',
        )}
      >
        {activeQuestion.options?.length ? (
          <div
            className="flex flex-col gap-2"
            aria-label={activeQuestion.header ?? activeQuestion.question}
          >
            {activeQuestion.options.map((option, index) => {
              const value = option.value ?? option.label
              const recommended = option.recommended ?? index === 0
              return (
                <Button
                  key={value}
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-16 w-full cursor-pointer justify-start gap-4 rounded-lg px-4 py-1 text-left whitespace-normal"
                  onClick={() => selectCurrentOption(value)}
                  disabled={submitting || transitioning}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-8 shrink-0 items-center justify-center rounded-full border text-base',
                      activeResponse?.selectedValue === value
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-app-border-strong text-app-text-muted',
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-base leading-snug font-semibold text-foreground">
                      {option.label}
                      {recommended ? <span className="ml-2">(Recommended)</span> : null}
                    </span>
                    <span className="text-base leading-6 text-app-text-muted">
                      {option.description}
                    </span>
                  </span>
                </Button>
              )
            })}
          </div>
        ) : null}

        <FieldGroup className="gap-0 px-2 pb-1">
          <Field
            orientation="horizontal"
            className={cn(
              'app-interactive-no-press flex cursor-pointer items-center gap-3 rounded-full border-2 px-2 py-2',
              emptySubmitError
                ? 'border-destructive has-[input:focus]:border-destructive'
                : 'border-transparent has-[input:focus]:border-primary',
              draft.trim() && !emptySubmitError ? 'border-primary' : null,
            )}
          >
            <span
              aria-hidden="true"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-app-border-strong text-app-text-muted"
            >
              <Pencil className="size-4" />
            </span>
            <FieldLabel htmlFor={`questionnaire-${activeQuestion.id}`} className="sr-only">
              {activeQuestion.question}
            </FieldLabel>
            <Input
              id={`questionnaire-${activeQuestion.id}`}
              type={activeQuestion.isSecret ? 'password' : 'text'}
              value={draft}
              onChange={(event) => {
                setResponses((current) => ({
                  ...current,
                  [activeQuestion.id]: {
                    input: event.target.value,
                    selectedValue: event.target.value
                      ? undefined
                      : current[activeQuestion.id]?.selectedValue,
                  },
                }))
                setEmptySubmitError(false)
              }}
              placeholder={inputPlaceholder}
              disabled={submitting || transitioning}
              className="ml-1 h-8 border-0 bg-transparent! px-0 text-base shadow-none focus-visible:border-0 focus-visible:ring-0"
            />
            <Button
              type="button"
              variant="outline"
              className="rounded-full text-sm font-medium"
              onClick={skipCurrentQuestion}
              disabled={submitting || transitioning}
            >
              Skip
            </Button>
          </Field>
        </FieldGroup>
      </div>
    </form>
  )
}
