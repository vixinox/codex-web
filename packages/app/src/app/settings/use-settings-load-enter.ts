import * as React from 'react'

import { useNativeEnter } from '@/lib/platform/browser/use-native-enter'

export function useSettingsLoadEnter<T extends HTMLElement>(dependencies: React.DependencyList) {
  return useNativeEnter<T>(dependencies, { duration: 0.3, y: 4 })
}
