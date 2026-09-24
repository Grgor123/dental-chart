import { useCallback, useEffect, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';
import { TEMPLATE_DEFS, type TemplateKey, type TemplateOverride } from '../../supabase/functions/_shared/email/templateDefs';

// Per-practice email template overrides — supabase/migrations/
// 019_add_email_templates.sql. The platform defaults live in code
// (supabase/functions/_shared/email/templateDefs.ts, imported directly so the
// editor and the Edge Functions share one source of truth); a row here only
// overrides them, and no row means "use the default". Like therapists, no
// parent row to derive practice_id from, so it's set explicitly on insert.
export type TemplateOverrides = Partial<Record<TemplateKey, TemplateOverride>>;

/** What the editor form holds — text fields are never null here, they start as
    the effective (override-or-default) wording. */
export interface TemplateFormValues {
  subject: string;
  heading: string;
  body: string;
  enabled: boolean;
  timingValue: number | null;
  sendHour: number | null;
}

const OVERRIDE_COLUMNS = 'template_key, subject, heading, body, enabled, timing_value, send_hour';

async function messageFromInvokeError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body && typeof body.error === 'string') return body.error;
    } catch {
      // fall through to the generic message
    }
  }
  return error instanceof Error ? error.message : 'Neznana napaka';
}

// A field equal to the platform default is stored as null, so a later
// improvement to the default wording still reaches practices that never
// actually customized that field.
function nullIfDefault(value: string, fallback: string): string | null {
  return value.trim() === '' || value === fallback ? null : value;
}

export function useEmailTemplates() {
  const { practiceId } = usePracticeContext();
  const [overrides, setOverrides] = useState<TemplateOverrides>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from('email_templates').select(OVERRIDE_COLUMNS);
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    const next: TemplateOverrides = {};
    for (const row of (data ?? []) as unknown as (TemplateOverride & { template_key: TemplateKey })[]) {
      next[row.template_key] = {
        subject: row.subject,
        heading: row.heading,
        body: row.body,
        enabled: row.enabled,
        timing_value: row.timing_value,
        send_hour: row.send_hour,
      };
    }
    setOverrides(next);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveTemplate = useCallback(
    async (key: TemplateKey, values: TemplateFormValues): Promise<{ error?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const def = TEMPLATE_DEFS[key];
      const { error } = await supabase.from('email_templates').upsert(
        {
          practice_id: practiceId,
          template_key: key,
          subject: nullIfDefault(values.subject, def.defaultSubject),
          heading: nullIfDefault(values.heading, def.defaultHeading),
          body: nullIfDefault(values.body, def.defaultBody),
          enabled: values.enabled,
          timing_value: def.timing && values.timingValue !== def.timing.default ? values.timingValue : null,
          send_hour: def.sendHourDefault !== null && values.sendHour !== def.sendHourDefault ? values.sendHour : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'practice_id,template_key' }
      );
      if (error) return { error: error.message };
      await reload();
      return {};
    },
    [practiceId, reload]
  );

  // Deleting the row IS "reset to default" (the default lives in code).
  const resetTemplate = useCallback(
    async (key: TemplateKey): Promise<{ error?: string }> => {
      const { error } = await supabase.from('email_templates').delete().eq('template_key', key);
      if (error) return { error: error.message };
      await reload();
      return {};
    },
    [reload]
  );

  const previewTemplate = useCallback(
    async (key: TemplateKey, values: Pick<TemplateFormValues, 'subject' | 'heading' | 'body'>): Promise<{ html: string } | { error: string }> => {
      const { data, error } = await supabase.functions.invoke('email-template-preview', {
        body: { templateKey: key, override: values },
      });
      if (error) return { error: await messageFromInvokeError(error) };
      return { html: (data as { html: string }).html };
    },
    []
  );

  const sendTestEmail = useCallback(
    async (key: TemplateKey, values: Pick<TemplateFormValues, 'subject' | 'heading' | 'body'>): Promise<{ sentTo: string } | { error: string }> => {
      const { data, error } = await supabase.functions.invoke('email-template-preview', {
        body: { templateKey: key, override: values, sendTest: true },
      });
      if (error) return { error: await messageFromInvokeError(error) };
      return { sentTo: (data as { sentTo: string }).sentTo };
    },
    []
  );

  return { overrides, loading, error, saveTemplate, resetTemplate, previewTemplate, sendTestEmail };
}
