import { describe, expect, it } from 'vitest'
import {
  isKnownTelemetryErrorCode,
  TelemetryErrorCode,
  type KnownTelemetryErrorCode,
  type PublicErrorDto,
} from '@codex-web/telemetry/errors'
import { AppLocalError, AppLocalErrorCode } from './app-local-error'
import { OWNER_ERROR_COPY, presentAppError, presentPublicError } from './presentation'

describe('Owner error presentation', () => {
  it('localizes every known Owner code', () => {
    const ownerCodes = Object.values(TelemetryErrorCode).filter(
      (code): code is Extract<KnownTelemetryErrorCode, `owner.${string}`> =>
        code.startsWith('owner.'),
    )
    expect(Object.keys(OWNER_ERROR_COPY).sort()).toEqual(ownerCodes.sort())
  })

  it('uses only approved enrollment reason values for interpolation', () => {
    expect(
      presentPublicError(
        {
          code: TelemetryErrorCode.ownerEnrollmentTicketInvalid,
          params: { reason: 'expired' },
          retryable: false,
        },
        'en',
      ),
    ).toBe('This enrollment ticket has expired. Request a new one.')
    expect(
      presentPublicError(
        {
          code: TelemetryErrorCode.ownerEnrollmentTicketInvalid,
          params: { reason: '/private/path', arbitrary: 'secret' },
          retryable: false,
        } as PublicErrorDto,
        'en',
      ),
    ).toBe('Something went wrong. Please try again.')
  })

  it('shows an unknown code safe message but hides invalid DTOs and raw codes', () => {
    expect(
      presentPublicError(
        { code: 'owner.future.feature-paused', retryable: true, message: 'Try again later.' },
        'en',
      ),
    ).toBe('Try again later.')
    expect(presentPublicError({ code: 'owner.future.feature-paused', retryable: true }, 'en')).toBe(
      'Something went wrong. Please try again.',
    )
    expect(
      presentPublicError(
        {
          code: 'owner.future.feature-paused',
          retryable: true,
          message: 'token=secret',
        },
        'en',
      ),
    ).toBe('Something went wrong. Please try again.')
    expect(
      presentPublicError(
        {
          code: 'owner.future.feature-paused',
          retryable: true,
          message: 'Safe fallback.',
          extra: true,
        },
        'en',
      ),
    ).toBe('Something went wrong. Please try again.')
  })

  it('does not let a missing known-code translation fall back to server text', () => {
    expect(
      presentPublicError(
        {
          code: TelemetryErrorCode.ownerAuthUnauthorized,
          retryable: false,
          message: 'Server controlled text',
        },
        'en',
      ),
    ).toBe('Sign in to continue.')
  })

  it('preserves retryability and localizes app-owned errors', () => {
    const dto: PublicErrorDto = {
      code: TelemetryErrorCode.ownerRequestTimeout,
      retryable: true,
      message: 'ignored for a known code',
    }
    expect(isKnownTelemetryErrorCode(dto.code)).toBe(true)
    expect(presentPublicError(dto, 'en')).toBe('The request timed out. Try again.')
    expect(
      presentAppError(
        new AppLocalError(AppLocalErrorCode.ownerRequestCancelled, 'localized'),
        undefined,
        'en',
      ),
    ).toBe('The request was cancelled.')
  })
})
