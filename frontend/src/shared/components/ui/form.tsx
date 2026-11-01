import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ComponentPropsWithoutRef,
  type HTMLAttributes,
} from 'react'
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { cn } from '@/shared/lib/cn'
import { Label } from '@/shared/components/ui/label'
import { Slot } from '@radix-ui/react-slot'

const Form = FormProvider

interface FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> {
  name: TName
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null)

function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const FormItemContext = createContext<string | null>(null)

function useFormField() {
  const fieldContext = useContext(FormFieldContext)
  const itemContext = useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext) {
    throw new Error('useFormField must be used inside a <FormField>')
  }

  const fieldState = getFieldState(fieldContext.name, formState)

  return {
    id: itemContext ?? undefined,
    name: fieldContext.name,
    formItemId: itemContext ?? undefined,
    formDescriptionId: itemContext ? `${itemContext}-description` : undefined,
    formMessageId: itemContext ? `${itemContext}-message` : undefined,
    ...fieldState,
  }
}

type FormItemProps = HTMLAttributes<HTMLDivElement>

function FormItemInner(props: FormItemProps, ref: React.Ref<HTMLDivElement>) {
  const { className, ...rest } = props
  const fieldId = useId()
  return (
    <FormItemContext.Provider value={fieldId}>
      <div ref={ref} className={cn('flex flex-col gap-2', className)} {...rest} />
    </FormItemContext.Provider>
  )
}

export const FormItem = forwardRef(FormItemInner)

type FormLabelProps = ComponentPropsWithoutRef<typeof Label>

function FormLabelInner(props: FormLabelProps, ref: React.Ref<HTMLLabelElement>) {
  const { className, ...rest } = props
  const { error, formItemId } = useFormField()
  return (
    <Label
      ref={ref}
      className={cn(error && 'text-danger', className)}
      htmlFor={formItemId}
      {...rest}
    />
  )
}

export const FormLabel = forwardRef(FormLabelInner)

type FormControlProps = ComponentPropsWithoutRef<'div'>

function FormControlInner(props: FormControlProps, ref: React.Ref<HTMLElement>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
  const { className, ...rest } = props
  return (
    <Slot
      ref={ref}
      className={className}
      id={formItemId}
      aria-invalid={!!error}
      aria-describedby={error ? formMessageId : formDescriptionId}
      {...rest}
    />
  )
}

export const FormControl = forwardRef(FormControlInner)

type FormDescriptionProps = HTMLAttributes<HTMLParagraphElement>

function FormDescriptionInner(
  props: FormDescriptionProps,
  ref: React.Ref<HTMLParagraphElement>,
) {
  const { className, ...rest } = props
  const { formDescriptionId } = useFormField()
  return (
    <p ref={ref} id={formDescriptionId} className={cn('text-xs text-ink', className)} {...rest} />
  )
}

export const FormDescription = forwardRef(FormDescriptionInner)

type FormMessageProps = HTMLAttributes<HTMLParagraphElement>

function FormMessageInner(props: FormMessageProps, ref: React.Ref<HTMLParagraphElement>) {
  const { className, children, ...rest } = props
  const { error, formMessageId } = useFormField()
  const body = error ? String(error.message ?? '') : children
  if (!body) return null
  return (
    <p
      ref={ref}
      id={formMessageId}
      role="alert"
      className={cn('text-xs font-medium text-danger', className)}
      {...rest}
    >
      {body}
    </p>
  )
}

export const FormMessage = forwardRef(FormMessageInner)

export { Form, FormField }