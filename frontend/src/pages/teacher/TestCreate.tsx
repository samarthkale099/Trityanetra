import { useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useMutation } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, LoaderCircle, Plus, Trash2 } from 'lucide-react'
import { classroomApi } from '@/features/classrooms/classroomApi'
import { createTestSchema, type CreateTestValues } from '@/features/classrooms/schemas'
import { describeCountdown, formatWindow, testStatus } from '@/features/exam/testWindow'
import { istInputToUtcIso, parseIstInputMs, utcIsoToIstInput } from '@/shared/lib/datetime'
import { PageHeader } from '@/shared/components/page-header'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { Label } from '@/shared/components/ui/label'
import { Badge } from '@/shared/components/ui/badge'
import { Card } from '@/shared/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select'
import { ErrorState } from '@/shared/components/ui/error-state'
import { toast } from '@/shared/components/ui/toast'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form'
import { EXAM_LANGUAGES, LANGUAGE_LABELS, type ExamLanguage } from '@/shared/types/classroom'

/** Default window: opens in 15 minutes, runs for an hour, shown in IST. */
function defaultWindow() {
  const start = new Date(Date.now() + 15 * 60_000)
  const end = new Date(start.getTime() + 60 * 60_000)
  return { start: utcIsoToIstInput(start.toISOString()), end: utcIsoToIstInput(end.toISOString()) }
}

export function TestCreatePage() {
  const { classroomId } = useParams<{ classroomId: string }>()
  const navigate = useNavigate()
  const inFlight = useRef(false)
  const [submitting, setSubmitting] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const defaults = useMemo(() => {
    // Not named `window`: that would shadow the global inside this scope.
    const initialWindow = defaultWindow()
    return {
      title: '',
      instructions: '',
      language: 'javascript' as ExamLanguage,
      windowStartLocal: initialWindow.start,
      windowEndLocal: initialWindow.end,
      durationMinutes: 60,
      questions: [{ prompt: '', starterCode: '', points: 10 }],
    }
  }, [])

  const form = useForm<CreateTestValues>({
    resolver: zodResolver(createTestSchema),
    defaultValues: defaults,
    mode: 'onBlur',
  })

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'questions' })

  const createTest = useMutation({
    mutationFn: (values: CreateTestValues) =>
      classroomApi.createTest(classroomId as string, {
        title: values.title,
        instructions: values.instructions,
        language: values.language,
        windowStart: istInputToUtcIso(values.windowStartLocal),
        windowEnd: istInputToUtcIso(values.windowEndLocal),
        durationMinutes: values.durationMinutes,
        questions: values.questions.map((question) => ({
          prompt: question.prompt,
          starterCode: question.starterCode,
          points: question.points,
          testCases: [],
        })),
      }),
    onSuccess: (test) => {
      toast.success('Test created', { description: `${test.title} is scheduled.` })
      // Back to the classroom that owns the test, which is where the new row
      // becomes visible. The classroom id comes from the route param.
      navigate(`/app/classrooms/${encodeURIComponent(classroomId as string)}`, { replace: true })
    },
    onError: (error: Error) => {
      toast.error('Could not create the test', { description: error.message })
    },
  })

  const onSubmit = async (values: CreateTestValues) => {
    if (inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    try {
      await createTest.mutateAsync(values)
    } catch {
      // Surfaced by `onError`; the form keeps its values so nothing is lost.
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  // Preview reads the form's current values, so it reflects an in-progress edit
  // rather than only what passed validation. The window fields are IST wall
  // clock, so they are parsed as IST here exactly as the payload converts them.
  const watch = form.watch()
  const previewWindow = useMemo(() => {
    const start = parseIstInputMs(watch.windowStartLocal)
    const end = parseIstInputMs(watch.windowEndLocal)
    if (start === null || end === null) return null
    return {
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      durationMinutes: watch.durationMinutes,
    }
  }, [watch.windowStartLocal, watch.windowEndLocal, watch.durationMinutes])

  const previewStatus = previewWindow ? testStatus(previewWindow, Date.now()) : null
  const totalPoints = (watch.questions ?? []).reduce((total, question) => total + (question?.points ?? 0), 0)

  if (!classroomId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ErrorState
          title="No classroom selected"
          message="This address is missing a classroom id. Open a classroom from your list."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl">
      <PageHeader
        breadcrumbs={[
          { label: 'Classrooms', to: '/app/classrooms' },
          { label: 'Classroom', to: `/app/classrooms/${encodeURIComponent(classroomId)}` },
          { label: 'New test' },
        ]}
        title="Create a test"
        description="Set the window, write the questions, and publish it to your students."
        actions={
          <Button variant="secondary" onClick={() => setShowPreview((value) => !value)} aria-pressed={showPreview}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            {showPreview ? 'Hide preview' : 'Preview'}
          </Button>
        }
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex min-w-0 flex-1 flex-col gap-6"
            noValidate
          >
            <Card className="p-6">
              <h2 className="text-lg font-semibold text-ink-strong">Details</h2>
              <div className="mt-4 flex flex-col gap-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Title</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Mid-term: Sorting" autoComplete="off" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="language"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Language</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger aria-label="Language">
                            <SelectValue placeholder="Choose a language" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {EXAM_LANGUAGES.map((language) => (
                            <SelectItem key={language} value={language}>
                              {LANGUAGE_LABELS[language]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="instructions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instructions (optional)</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          rows={3}
                          placeholder="Do not use the built-in sort."
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold text-ink-strong">Test window</h2>
              <p className="mt-1 text-sm text-ink">
                Students can only start inside this window. Times are in IST (Asia/Kolkata) and are
                stored as UTC.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="windowStartLocal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Opens</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="windowEndLocal"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Closes</FormLabel>
                      <FormControl>
                        <Input type="datetime-local" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="durationMinutes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Time allowed (minutes)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={480}
                          inputMode="numeric"
                          {...field}
                          onChange={(event) => field.onChange(event.target.valueAsNumber)}
                          value={Number.isNaN(field.value) ? '' : field.value}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </Card>

            <Card className="p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink-strong">Questions</h2>
                  <p className="mt-1 text-sm text-ink">
                    {fields.length} {fields.length === 1 ? 'question' : 'question(s)'} - {totalPoints}{' '}
                    points total
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    append({ prompt: '', starterCode: '', points: 10 })
                  }
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add question
                </Button>
              </div>

              <fieldset className="mt-4 flex flex-col gap-4">
                <legend className="sr-only">Questions</legend>
                {fields.map((field, index) => (
                  <div
                    key={field.id}
                    /* Recessed rather than flat: each question is a sub-unit
                       inside the card, and a sunken fill separates the two
                       levels without needing a second border. */
                    className="rounded-lg border border-line bg-canvas-sunken p-4"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <Label htmlFor={`question-${index}-prompt`} className="font-semibold text-ink-strong">
                        Question {index + 1}
                      </Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove question ${index + 1}`}
                        disabled={fields.length === 1}
                        onClick={() => remove(index)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Remove
                      </Button>
                    </div>
                    <div className="flex flex-col gap-4">
                      <FormField
                        control={form.control}
                        name={`questions.${index}.prompt`}
                        render={({ field: promptField }) => (
                          <FormItem>
                            <Label htmlFor={`question-${index}-prompt`} className="sr-only">
                              Question {index + 1} prompt
                            </Label>
                            <FormControl>
                              <Textarea
                                {...promptField}
                                id={`question-${index}-prompt`}
                                rows={3}
                                placeholder="Implement quicksort on an array of integers."
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`questions.${index}.starterCode`}
                        render={({ field: codeField }) => (
                          <FormItem>
                            <Label
                              htmlFor={`question-${index}-code`}
                              className="text-xs font-medium text-ink-faint"
                            >
                              Starter code (optional)
                            </Label>
                            <FormControl>
                              <Textarea
                                {...codeField}
                                id={`question-${index}-code`}
                                rows={3}
                                className="font-mono text-sm"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`questions.${index}.points`}
                        render={({ field: pointsField }) => (
                          <FormItem className="max-w-[10rem]">
                            <FormLabel>Points</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={1}
                                max={1000}
                                inputMode="numeric"
                                {...pointsField}
                                onChange={(event) => pointsField.onChange(event.target.valueAsNumber)}
                                value={Number.isNaN(pointsField.value) ? '' : pointsField.value}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                ))}
              </fieldset>
            </Card>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(`/app/classrooms/${encodeURIComponent(classroomId)}`)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {submitting ? 'Creating' : 'Create test'}
              </Button>
            </div>
          </form>
        </Form>

        {showPreview ? (
          <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-80" aria-label="Student preview">
            <Card className="p-5">
              <h2 className="text-lg font-semibold text-ink-strong">Student preview</h2>
              <p className="mt-3 font-medium text-ink-strong">
                {watch.title?.trim() || <span className="text-ink-faint">Untitled test</span>}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline">{LANGUAGE_LABELS[watch.language]}</Badge>
                <Badge variant="outline">{fields.length} questions</Badge>
                <Badge variant="outline">{totalPoints} points</Badge>
              </div>

              <div className="mt-4 border-t border-line pt-4">
                <p className="text-xs font-medium text-ink-faint">Window</p>
                {previewWindow ? (
                  <>
                    <p className="mt-1.5 text-sm text-ink">{formatWindow(previewWindow)}</p>
                    {previewStatus ? (
                      <p className="mt-2 text-sm text-ink">
                        {previewStatus === 'LIVE'
                          ? 'Open now - students can start.'
                          : previewStatus === 'UPCOMING'
                            ? `Opens ${describeCountdown(Date.parse(previewWindow.windowStart) - Date.now())}.`
                            : 'Already closed.'}
                      </p>
                    ) : null}
                    {watch.durationMinutes > 0 ? (
                      <p className="mt-1 text-sm text-ink">
                        {watch.durationMinutes} minutes per student.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-1.5 text-sm text-ink-faint">Set both dates to see the window.</p>
                )}
              </div>

              {watch.instructions?.trim() ? (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-xs font-medium text-ink-faint">Instructions</p>
                  <p className="mt-1.5 whitespace-pre-line text-sm text-ink">{watch.instructions}</p>
                </div>
              ) : null}

              <div className="mt-4 border-t border-line pt-4">
                <p className="text-xs font-medium text-ink-faint">Questions</p>
                <ol className="mt-2 flex flex-col gap-2">
                  {fields.map((_, index) => (
                    <li key={index} className="text-sm text-ink">
                      {index + 1}.{' '}
                      {watch.questions?.[index]?.prompt?.trim() || (
                        <span className="text-ink-faint">Empty question</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            </Card>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
