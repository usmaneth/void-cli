// Auto-generated stub for missing module
export type WizardContextValue<T = any> = {
  wizardData: T
  updateWizardData: (data: Partial<T>) => void
  currentStepIndex: number
  totalSteps: number
  goNext: () => void
  goBack: () => void
  goToStep: (step: number) => void
  cancel: () => void
  title?: string
  showStepCounter?: boolean
}
export type WizardProviderProps = any
export const WizardProviderProps: any = ((..._: any[]) => {}) as any
export type WizardStepComponent = any
export const WizardStepComponent: any = ((..._: any[]) => {}) as any
