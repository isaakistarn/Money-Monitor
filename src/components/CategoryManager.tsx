import { useState } from 'react'
import { Card, SectionHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { IconPlus, IconTrash } from '@/components/ui/icons'
import { useCategories } from '@/hooks/useData'
import { useUI } from '@/state/ui'
import { addCategory, updateCategory, deleteCategory, categoryUsage } from '@/db/repo'
import { cn } from '@/lib/cn'
import type { Category, CategoryKind } from '@/types/models'

const SUGGESTED_ICONS = [
  '🍔', '☕', '🚗', '🚌', '🎬', '🎮', '🛍️', '🏠', '💡', '🩺', '💊', '📚',
  '🔁', '📱', '✈️', '🏖️', '🎁', '🐶', '👶', '💪', '🎵', '🍺', '🧾', '📦',
  '💼', '🏢', '📈', '💰', '🪙', '➕',
]

interface Draft {
  id?: string
  kind: CategoryKind
  name: string
  icon: string
}

export function CategoryManager() {
  const categories = useCategories()
  const { toast } = useUI()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [draft, setDraft] = useState<Draft | null>(null)
  // Delete flow (inside the edit modal): how many transactions reference the
  // category, and where they should move.
  const [deleting, setDeleting] = useState(false)
  const [usage, setUsage] = useState(0)
  const [reassignTo, setReassignTo] = useState('')

  const visible = (categories ?? [])
    .filter((c) => c.kind === kind)
    .sort((a, b) => a.name.localeCompare(b.name))
  const reassignOptions = (categories ?? [])
    .filter((c) => c.kind === draft?.kind && c.id !== draft?.id)
    .sort((a, b) => a.name.localeCompare(b.name))

  const open = (c?: Category) => {
    setDeleting(false)
    setReassignTo('')
    setDraft(c ? { id: c.id, kind: c.kind, name: c.name, icon: c.icon } : { kind, name: '', icon: '' })
  }

  const save = async () => {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      toast('Enter a category name', 'error')
      return
    }
    const duplicate = (categories ?? []).some(
      (c) => c.kind === draft.kind && c.id !== draft.id && c.name.toLowerCase() === name.toLowerCase(),
    )
    if (duplicate) {
      toast(`A ${draft.kind} category with that name already exists`, 'error')
      return
    }
    if (draft.id) {
      await updateCategory(draft.id, { name, icon: draft.icon.trim() || '🏷️' })
      toast('Category updated', 'success')
    } else {
      await addCategory({ name, kind: draft.kind, icon: draft.icon })
      toast('Category added', 'success')
    }
    setDraft(null)
  }

  const startDelete = async () => {
    if (!draft?.id) return
    setUsage(await categoryUsage(draft.id))
    setReassignTo('')
    setDeleting(true)
  }

  const confirmDelete = async () => {
    if (!draft?.id) return
    await deleteCategory(draft.id, reassignTo || undefined)
    toast('Category deleted')
    setDraft(null)
    setDeleting(false)
  }

  return (
    <Card className="p-5">
      <SectionHeader
        title="Categories"
        action={<Button size="sm" variant="secondary" onClick={() => open()}><IconPlus width={16} /> Add</Button>}
      />
      <div className="mb-3">
        <Segmented<CategoryKind>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'expense', label: 'Expenses' },
            { value: 'income', label: 'Income' },
          ]}
        />
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted py-2">
          No {kind} categories yet. Add one to start organising your {kind === 'income' ? 'income' : 'spending'}.
        </p>
      ) : (
        <div className="divide-y divide-border/60">
          {visible.map((c) => (
            <button key={c.id} onClick={() => open(c)} className="w-full flex items-center gap-3 py-2.5 text-left">
              <span className="shrink-0 grid place-items-center h-9 w-9 rounded-full bg-elevated text-base leading-none">
                {c.icon}
              </span>
              <span className="flex-1 min-w-0 text-sm font-medium truncate">{c.name}</span>
              {c.isDefault && <span className="shrink-0 text-xs text-faint">default</span>}
            </button>
          ))}
        </div>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={deleting ? 'Delete category' : draft?.id ? 'Edit category' : 'New category'}
        footer={
          deleting ? (
            <>
              <Button variant="secondary" onClick={() => setDeleting(false)}>Back</Button>
              <Button variant="danger" onClick={confirmDelete}><IconTrash width={16} /> Delete category</Button>
            </>
          ) : (
            <>
              {draft?.id && (
                <Button variant="ghost" className="mr-auto text-negative" onClick={startDelete}>
                  <IconTrash width={18} /> Delete
                </Button>
              )}
              <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </>
          )
        }
      >
        {draft && (deleting ? (
          <div className="space-y-4">
            <p className="text-sm text-muted leading-relaxed">
              Deleting <b>{draft.icon} {draft.name}</b> also removes its budgets.
              {usage > 0
                ? ` ${usage} transaction${usage === 1 ? '' : 's'} use${usage === 1 ? 's' : ''} it — amounts and balances stay exactly as they are; choose which category ${usage === 1 ? 'it' : 'they'} should show under.`
                : ' No transactions use it.'}
            </p>
            {usage > 0 && (
              <Field label="Move its transactions to">
                <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">No category (uncategorised)</option>
                  {reassignOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {!draft.id && (
              <Segmented<CategoryKind>
                value={draft.kind}
                onChange={(k) => setDraft({ ...draft, kind: k })}
                options={[
                  { value: 'expense', label: 'Expense' },
                  { value: 'income', label: 'Income' },
                ]}
              />
            )}
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={draft.kind === 'income' ? 'e.g. Side hustle' : 'e.g. Coffee'}
                maxLength={40}
                autoFocus
              />
            </Field>
            <Field label="Icon" hint="Pick one below, or type any emoji.">
              <div className="space-y-2">
                <Input
                  value={draft.icon}
                  onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                  placeholder="🏷️"
                  className="w-20 text-center text-lg"
                />
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTED_ICONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setDraft({ ...draft, icon: emoji })}
                      className={cn(
                        'grid place-items-center h-9 w-9 rounded-lg text-base leading-none transition-colors',
                        draft.icon === emoji ? 'bg-accent/15 ring-1 ring-accent' : 'bg-elevated hover:bg-border/60',
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </Field>
          </div>
        ))}
      </Modal>
    </Card>
  )
}
