import * as React from 'react'
import { CheckIcon, KeyRoundIcon, RefreshCwIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { RadioGroup } from '@/components/ui/radio-group'
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ProjectSummary } from '@/lib/bridge/http/projects'
import type { SettingsController } from './use-settings-controller'
import type { SettingsCollection, SettingsCredential } from '../model/types'
import { CredentialForm } from './credential-form'
import { CredentialRow, type CredentialTestState } from './credential-row'
import { ProjectSection, ResourceSection } from '../runtime/runtime-sections'
import { useSettingsLoadEnter } from '../use-settings-load-enter'

type PendingCredentialSwitch = { id: string; fromCredentialId: string | null }

type CredentialPanelProps = {
  controller: SettingsController
  projects?: SettingsCollection<ProjectSummary>
  onRetryProjects?: () => void
}

export function CredentialPanel({ controller, projects, onRetryProjects }: CredentialPanelProps) {
  const {
    credentials,
    selectedCredentialId,
    credentialErrors,
    saveCredential: onSaveCredential,
    selectCredential: onSelectCredential,
    deleteCredential: onDeleteCredential,
    retryCredentials: onRetryCredentials,
    testSavedCredential: onTestCredential,
    activeCredentialId,
    credentialActionError,
    credentialSavePending,
    codexActionPending,
    resetCredentialForm,
  } = controller
  const [pendingSwitch, setPendingSwitch] = React.useState<PendingCredentialSwitch | null>(null)
  const [addCredentialDialogOpen, setAddCredentialDialogOpen] = React.useState(false)
  const [credentialFormKey, setCredentialFormKey] = React.useState(0)
  const [switchDialogOpen, setSwitchDialogOpen] = React.useState(false)
  const [testStates, setTestStates] = React.useState<Record<string, CredentialTestState>>({})
  const testRequestIds = React.useRef<Record<string, number>>({})
  const credentialsListRef = useSettingsLoadEnter<HTMLDivElement>([credentials.status])
  const runtimePendingCredentialId =
    activeCredentialId && selectedCredentialId && activeCredentialId !== selectedCredentialId
      ? selectedCredentialId
      : null
  const pendingCredentialId =
    (pendingSwitch?.fromCredentialId === selectedCredentialId ? pendingSwitch.id : null) ??
    runtimePendingCredentialId
  const pendingCredential =
    credentials.status === 'ready'
      ? credentials.items.find(
          (credential) =>
            credential.id === pendingCredentialId &&
            (pendingSwitch ? credential.id !== selectedCredentialId : true),
        )
      : undefined

  function selectCredential(id: string) {
    setPendingSwitch(
      id === selectedCredentialId ? null : { id, fromCredentialId: selectedCredentialId },
    )
  }
  function confirmSwitch() {
    if (!pendingCredential) return
    void onSelectCredential(pendingCredential.id).catch(() => undefined)
    setPendingSwitch(null)
    setSwitchDialogOpen(false)
  }
  async function testCredential(credential: SettingsCredential) {
    const requestId = (testRequestIds.current[credential.id] ?? 0) + 1
    testRequestIds.current[credential.id] = requestId
    setTestStates((current) => ({ ...current, [credential.id]: { status: 'loading', requestId } }))
    const showResult = (status: 'success' | 'error', message?: string) => {
      setTestStates((current) => ({ ...current, [credential.id]: { status, message, requestId } }))
      window.setTimeout(() => {
        setTestStates((current) => {
          if (current[credential.id]?.requestId !== requestId) return current
          const next = { ...current }
          delete next[credential.id]
          return next
        })
      }, 2000)
    }
    try {
      const available = await (onTestCredential
        ? onTestCredential(credential)
        : testCredentialLocally(credential))
      showResult(available ? 'success' : 'error')
    } catch (error) {
      showResult('error', error instanceof Error ? error.message : 'Credential test failed.')
    }
  }

  function handleAddCredentialDialogChange(open: boolean) {
    if (credentialSavePending) return
    if (open) {
      resetCredentialForm()
      setCredentialFormKey((key) => key + 1)
    }
    setAddCredentialDialogOpen(open)
  }

  return (
    <div className="flex flex-col gap-8">
      {projects && onRetryProjects ? (
        <ProjectSection projects={projects} onRetry={onRetryProjects} />
      ) : null}
      <Dialog open={addCredentialDialogOpen} onOpenChange={handleAddCredentialDialogChange}>
        <ResourceSection
          heading="Saved credentials"
          collection={credentials}
          errorTitle="Could not load credentials"
          onRetry={onRetryCredentials}
          headerAction={
            <DialogTrigger render={<Button type="button" size="sm" />}>Add</DialogTrigger>
          }
          empty={
            <Empty className="w-full border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <KeyRoundIcon />
                </EmptyMedia>
                <EmptyTitle>No credentials</EmptyTitle>
              </EmptyHeader>
            </Empty>
          }
        >
          {(items) => (
            <div ref={credentialsListRef} className="w-full">
              <RadioGroup
                className="block"
                value={pendingCredentialId ?? selectedCredentialId ?? ''}
                onValueChange={selectCredential}
              >
                <div className="overflow-hidden rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Provider</TableHead>
                        <TableHead>Base URL</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-20 text-right"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((credential) => (
                        <CredentialRow
                          key={credential.id}
                          credential={credential}
                          isCurrent={credential.id === (activeCredentialId ?? selectedCredentialId)}
                          isPending={credential.id === pendingCredentialId}
                          testState={testStates[credential.id]}
                          onTest={() => void testCredential(credential)}
                          onDelete={() => onDeleteCredential(credential.id)}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </RadioGroup>
              {credentialActionError && !addCredentialDialogOpen ? (
                <Alert variant="destructive" className="mt-4">
                  <AlertTitle>Credential action failed</AlertTitle>
                  <AlertDescription>{credentialActionError}</AlertDescription>
                </Alert>
              ) : null}
              {pendingCredential && !codexActionPending ? (
                <div className="flex justify-start pt-1">
                  <AlertDialog open={switchDialogOpen} onOpenChange={setSwitchDialogOpen}>
                    <AlertDialogTrigger
                      render={<Button type="button" variant="default" className="mt-4" />}
                    >
                      <CheckIcon data-icon="inline-start" />
                      Confirm switch
                    </AlertDialogTrigger>
                    <AlertDialogContent size="sm">
                      <AlertDialogHeader>
                        <AlertDialogMedia>
                          <RefreshCwIcon />
                        </AlertDialogMedia>
                        <AlertDialogTitle>Switch credential?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Switching to {pendingCredential.provider} will restart Codex and terminate
                          the conversation currently in progress.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmSwitch}>
                          Switch credential
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ) : null}
            </div>
          )}
        </ResourceSection>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add credential</DialogTitle>
            <DialogDescription>
              Save a provider credential for future conversations.
            </DialogDescription>
          </DialogHeader>
          <CredentialForm
            key={credentialFormKey}
            errors={credentialErrors}
            saveError={credentialActionError}
            savePending={credentialSavePending}
            onSubmit={onSaveCredential}
            onSuccess={() => setAddCredentialDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

async function testCredentialLocally(credential: SettingsCredential) {
  await new Promise((resolve) => setTimeout(resolve, 500))
  try {
    const parsed = new URL(credential.baseUrl)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}
