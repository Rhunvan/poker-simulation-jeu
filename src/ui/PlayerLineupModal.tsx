import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'

import type { BotProfile } from '../config/botProfiles'

export interface PlayerLineupModalProps {
  isOpen: boolean
  profiles: BotProfile[]
  activeProfileIds: string[]
  maxActive: number
  onApply: (ids: string[]) => void
  onClose: () => void
}

type PlayerLineupDialogProps = Omit<PlayerLineupModalProps, 'isOpen'>

function selectionLimit(maxActive: number): number {
  if (!Number.isFinite(maxActive)) {
    return 0
  }

  return Math.max(0, Math.floor(maxActive))
}

function orderSelectedIds(profiles: BotProfile[], ids: Iterable<string>): string[] {
  const selectedIds = new Set(ids)
  return profiles.filter((profile) => selectedIds.has(profile.id)).map((profile) => profile.id)
}

function initialSelection(
  profiles: BotProfile[],
  activeProfileIds: string[],
  maxActive: number,
): string[] {
  const limit = selectionLimit(maxActive)
  const selectedIds = orderSelectedIds(profiles, activeProfileIds).slice(0, limit)

  if (selectedIds.length === 0 && limit > 0 && profiles.length > 0) {
    return [profiles[0].id]
  }

  return selectedIds
}

function PlayerLineupDialog({
  profiles,
  activeProfileIds,
  maxActive,
  onApply,
  onClose,
}: PlayerLineupDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const constraintId = useId()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const limit = selectionLimit(maxActive)
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>(() =>
    initialSelection(profiles, activeProfileIds, maxActive),
  )
  const selectedCount = selectedProfileIds.length
  const selectionIsValid = selectedCount >= 1 && selectedCount <= limit

  useEffect(() => {
    closeButtonRef.current?.focus()

    function handleKeydown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [onClose])

  function toggleProfile(profileId: string): void {
    setSelectedProfileIds((currentIds) => {
      if (currentIds.includes(profileId)) {
        return currentIds.filter((id) => id !== profileId)
      }

      if (currentIds.length >= limit) {
        return currentIds
      }

      return orderSelectedIds(profiles, [...currentIds, profileId])
    })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    if (!selectionIsValid) {
      return
    }

    onApply(orderSelectedIds(profiles, selectedProfileIds))
  }

  const constraintMessage =
    selectedCount === 0
      ? 'Choisis au moins 1 adversaire.'
      : selectedCount >= limit
        ? `Maximum atteint : ${limit} adversaire${limit > 1 ? 's' : ''}.`
        : `Tu peux sélectionner jusqu’à ${limit} adversaire${limit > 1 ? 's' : ''}.`

  return (
    <div className="lineup-backdrop" onClick={onClose}>
      <form
        className="lineup-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${constraintId}`}
        onClick={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <header className="lineup-head">
          <div className="lineup-heading">
            <p className="lineup-eyebrow">Composition de la table</p>
            <h2 id={titleId}>Qui joue cette session&nbsp;?</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="lineup-close"
            onClick={onClose}
            aria-label="Fermer la sélection des joueurs"
          >
            Fermer
          </button>
        </header>

        <div className="lineup-intro">
          <p id={descriptionId}>
            Active les profils présents aujourd’hui. Appliquer cette composition crée une nouvelle
            session avec ces joueurs.
          </p>
          <div className="lineup-selection-summary">
            <strong aria-live="polite">{selectedCount} joueurs + toi</strong>
            <span
              id={constraintId}
              className={selectedCount === 0 ? 'lineup-constraint lineup-constraint-error' : 'lineup-constraint'}
              aria-live="polite"
            >
              {constraintMessage}
            </span>
          </div>
        </div>

        <fieldset className="lineup-list">
          <legend className="lineup-sr-only">Profils disponibles</legend>
          {profiles.map((profile) => {
            const isSelected = selectedProfileIds.includes(profile.id)
            const isDisabled = !isSelected && selectedCount >= limit

            return (
              <label
                key={profile.id}
                className={[
                  'lineup-profile',
                  isSelected ? 'lineup-profile-active' : '',
                  isDisabled ? 'lineup-profile-disabled' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <input
                  className="lineup-checkbox"
                  type="checkbox"
                  checked={isSelected}
                  disabled={isDisabled}
                  onChange={() => toggleProfile(profile.id)}
                />
                <span className="lineup-profile-copy">
                  <span className="lineup-profile-heading">
                    <strong>{profile.displayName}</strong>
                    <span className="lineup-archetype">{profile.archetype}</span>
                  </span>
                  <span className="lineup-profile-summary">{profile.summary}</span>
                </span>
              </label>
            )
          })}

          {profiles.length === 0 ? (
            <p className="lineup-empty">Aucun profil de joueur n’est disponible.</p>
          ) : null}
        </fieldset>

        <footer className="lineup-footer">
          <p>La session actuelle sera remplacée lors de l’application.</p>
          <div className="lineup-actions">
            <button type="button" className="lineup-button" onClick={onClose}>
              Annuler
            </button>
            <button
              type="submit"
              className="lineup-button lineup-button-primary"
              disabled={!selectionIsValid}
            >
              Appliquer et nouvelle session
            </button>
          </div>
        </footer>
      </form>
    </div>
  )
}

export function PlayerLineupModal(props: PlayerLineupModalProps) {
  if (!props.isOpen) {
    return null
  }

  return (
    <PlayerLineupDialog
      profiles={props.profiles}
      activeProfileIds={props.activeProfileIds}
      maxActive={props.maxActive}
      onApply={props.onApply}
      onClose={props.onClose}
    />
  )
}
