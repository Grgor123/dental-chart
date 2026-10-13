import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePracticeContext } from '../contexts/PracticeContext';

// Aftercare topics ("Navodila po posegu", migration 034): the practice's
// library of instruction texts, and which price-list categories tick each one
// on an invoice. Root table — practice_id set from usePracticeContext().

export interface AftercareTopic {
  id: string;
  title: string;
  /** Plain text: blank line = paragraph, line break kept, **bold**. */
  body: string;
  sortOrder: number;
  isActive: boolean;
  /** A starter text nobody has reviewed yet — cleared on the first save. */
  needsReview: boolean;
  categoryIds: string[];
}

export interface AftercareTopicFields {
  title: string;
  body: string;
  isActive: boolean;
  categoryIds: string[];
}

export interface CategoryOption {
  id: string;
  name: string;
}

export function useAftercareTopics() {
  const { practiceId } = usePracticeContext();
  const [topics, setTopics] = useState<AftercareTopic[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [topicsResult, linksResult, categoriesResult] = await Promise.all([
      supabase.from('aftercare_topics').select('id, title, body, sort_order, is_active, needs_review').order('sort_order').order('title'),
      supabase.from('aftercare_topic_categories').select('topic_id, category_id'),
      supabase.from('service_categories').select('id, name').order('sort_order').order('name'),
    ]);
    const failure = topicsResult.error ?? linksResult.error ?? categoriesResult.error;
    if (failure) {
      setError(failure.message);
      setLoading(false);
      return;
    }
    const links = linksResult.data ?? [];
    setTopics(
      (topicsResult.data ?? []).map((t) => ({
        id: t.id as string,
        title: t.title as string,
        body: t.body as string,
        sortOrder: t.sort_order as number,
        isActive: t.is_active as boolean,
        needsReview: t.needs_review as boolean,
        categoryIds: links.filter((l) => l.topic_id === t.id).map((l) => l.category_id as string),
      }))
    );
    setCategories((categoriesResult.data ?? []).map((c) => ({ id: c.id as string, name: c.name as string })));
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const writeLinks = useCallback(
    async (topicId: string, categoryIds: string[]): Promise<{ error?: string }> => {
      const { error: deleteError } = await supabase.from('aftercare_topic_categories').delete().eq('topic_id', topicId);
      if (deleteError) return { error: deleteError.message };
      if (categoryIds.length === 0) return {};
      const { error: insertError } = await supabase
        .from('aftercare_topic_categories')
        .insert(categoryIds.map((categoryId) => ({ practice_id: practiceId, topic_id: topicId, category_id: categoryId })));
      return insertError ? { error: insertError.message } : {};
    },
    [practiceId]
  );

  const createTopic = useCallback(
    async (fields: AftercareTopicFields): Promise<{ error?: string; id?: string }> => {
      if (!practiceId) return { error: 'Ordinacija ni bila najdena — poskusite znova po ponovni prijavi.' };
      const nextSortOrder = topics.reduce((max, t) => Math.max(max, t.sortOrder), 0) + 10;
      const { data, error: insertError } = await supabase
        .from('aftercare_topics')
        .insert({
          practice_id: practiceId,
          title: fields.title.trim(),
          body: fields.body,
          is_active: fields.isActive,
          sort_order: nextSortOrder,
        })
        .select('id')
        .single();
      if (insertError) return { error: insertError.message };
      const linkResult = await writeLinks(data.id as string, fields.categoryIds);
      await reload();
      return linkResult.error ? linkResult : { id: data.id as string };
    },
    [practiceId, topics, writeLinks, reload]
  );

  // Saving is the review: needs_review is cleared on every save.
  const saveTopic = useCallback(
    async (id: string, fields: AftercareTopicFields): Promise<{ error?: string }> => {
      const { error: updateError } = await supabase
        .from('aftercare_topics')
        .update({
          title: fields.title.trim(),
          body: fields.body,
          is_active: fields.isActive,
          needs_review: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (updateError) return { error: updateError.message };
      const linkResult = await writeLinks(id, fields.categoryIds);
      await reload();
      return linkResult;
    },
    [writeLinks, reload]
  );

  // Issued invoices keep their topic ids; a deleted topic simply no longer
  // resolves (nothing was sent from it after the fact).
  const deleteTopic = useCallback(
    async (id: string): Promise<{ error?: string }> => {
      const { error: deleteError } = await supabase.from('aftercare_topics').delete().eq('id', id);
      if (deleteError) return { error: deleteError.message };
      await reload();
      return {};
    },
    [reload]
  );

  return { topics, categories, loading, error, reload, createTopic, saveTopic, deleteTopic };
}
