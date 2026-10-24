import * as React from 'react'

const MobileNavigationCloseContext = React.createContext<(() => void) | null>(null)

export function MobileNavigationCloseProvider({
  close,
  children,
}: {
  close: () => void
  children: React.ReactNode
}) {
  return (
    <MobileNavigationCloseContext.Provider value={close}>
      {children}
    </MobileNavigationCloseContext.Provider>
  )
}

export function useMobileNavigationClose() {
  return React.useContext(MobileNavigationCloseContext)
}

export function useIsMobileNavigation() {
  return React.useContext(MobileNavigationCloseContext) !== null
}
