import * as React from 'react'
import { CheckCircle2Icon, MoreVerticalIcon, Trash2Icon, XCircleIcon } from 'lucide-react'
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
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { TableCell, TableRow } from '@/components/ui/table'
import { RadioGroupItem } from '@/components/ui/radio-group'
import type { SettingsCredential } from '../model/types'

export type CredentialTestState = {
  status: 'loading' | 'success' | 'error'
  message?: string
  requestId: number
}

export function CredentialRow({
  credential,
  isCurrent,
  isPending,
  testState,
  onTest,
  onDelete,
}: {
  credential: SettingsCredential
  isCurrent: boolean
  isPending: boolean
  testState?: CredentialTestState
  onTest: () => void
  onDelete: () => void | Promise<void>
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  return (
    <TableRow data-state={isPending ? 'pending' : undefined}>
      <TableCell className={isPending ? 'bg-primary/5' : undefined}>
        <label
          htmlFor={`offline-credential-${credential.id}`}
          className="flex min-w-44 cursor-pointer items-center gap-2"
        >
          <RadioGroupItem value={credential.id} id={`offline-credential-${credential.id}`} />
          <span className="truncate font-medium">{credential.provider}</span>
        </label>
      </TableCell>
      <TableCell className={isPending ? 'bg-primary/5' : undefined}>
        <span className="block max-w-sm min-w-56 truncate text-muted-foreground">
          {credential.baseUrl}
        </span>
      </TableCell>
      <TableCell className={isPending ? 'bg-primary/5' : undefined}>
        <div className="flex min-w-28 flex-wrap items-center gap-1.5">
          {isCurrent ? <Badge>Current</Badge> : null}
          {isPending ? <Badge variant="outline">Pending switch</Badge> : null}
        </div>
      </TableCell>
      <TableCell className={isPending ? 'bg-primary/5' : undefined}>
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Actions for ${credential.provider} credential`}
                />
              }
            >
              <span
                key={testState?.status ?? 'idle'}
                className="animate-in duration-200 fade-in-0 zoom-in-75"
              >
                {testState?.status === 'loading' ? (
                  <Spinner />
                ) : testState?.status === 'success' ? (
                  <CheckCircle2Icon className="text-success" />
                ) : testState?.status === 'error' ? (
                  <XCircleIcon className="text-destructive" />
                ) : (
                  <MoreVerticalIcon />
                )}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-fit">
              <DropdownMenuItem onClick={onTest} disabled={testState?.status === 'loading'}>
                Test connection
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
                Delete credential
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <CredentialDeleteDialog
            credential={credential}
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
            onDelete={onDelete}
          />
        </div>
      </TableCell>
    </TableRow>
  )
}

function CredentialDeleteDialog({
  credential,
  open,
  onOpenChange,
  onDelete,
}: {
  credential: SettingsCredential
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void | Promise<void>
}) {
  async function confirmDelete() {
    try {
      await onDelete()
      onOpenChange(false)
    } catch {
      // The parent renders the safe action error.
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete credential?</AlertDialogTitle>
          <AlertDialogDescription>
            {credential.provider} at {credential.baseUrl} will no longer be available for new
            conversations.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirmDelete}>
            Delete credential
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
