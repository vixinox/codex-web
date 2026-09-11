import {
  FileCode2Icon,
  Globe2Icon,
  ImageIcon,
  ListChecksIcon,
  MessagesSquareIcon,
  RotateCcwIcon,
  SquareTerminalIcon,
  WrenchIcon,
} from 'lucide-react'
import type { ChatActivityKind } from '@/app/chat/model/types'

export function ActivityIcon({ kind }: { kind: ChatActivityKind }) {
  const Icon =
    kind === 'command'
      ? SquareTerminalIcon
      : kind === 'search'
        ? Globe2Icon
        : kind === 'file'
          ? FileCode2Icon
          : kind === 'plan'
            ? ListChecksIcon
            : kind === 'reasoning'
              ? RotateCcwIcon
              : kind === 'agent'
                ? MessagesSquareIcon
                : kind === 'image'
                  ? ImageIcon
                  : WrenchIcon
  return <Icon className="size-3.5 shrink-0 text-app-text-subtle" />
}
