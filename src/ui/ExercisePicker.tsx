import React, { useMemo, useState } from 'react';
import { CATALOG, exerciseName, searchCatalog } from '../domain/catalog';
import { equipmentLabel, exerciseMuscleLabels } from '../domain/catalogData';
import type { Exercise } from '../domain/strength';
import { Button, Copy, Input, Row, Sheet } from './components';
import { tr } from '../domain/i18n';

/** The local collection stays fully searchable even without a network. */
export function ExercisePicker({
  visible,
  onSelect,
  onClose,
}: {
  visible: boolean;
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(40);
  const results = useMemo(() => searchCatalog(query, CATALOG.length), [query]);
  return (
    <Sheet
      visible={visible}
      title={tr('Übung wählen', 'Choose exercise')}
      onClose={onClose}
    >
      <Input
        label={tr('Übung suchen', 'Search exercises')}
        value={query}
        onChangeText={value => {
          setQuery(value);
          setLimit(40);
        }}
      />
      {results.slice(0, limit).map(exercise => (
        <Row
          key={exercise.id}
          title={exerciseName(exercise)}
          subtitle={[
            equipmentLabel(exercise.equipment),
            ...exerciseMuscleLabels(exercise),
          ].join(' · ')}
          onPress={() => {
            setQuery('');
            setLimit(40);
            onSelect(exercise);
          }}
        />
      ))}
      {!results.length ? (
        <Copy muted>
          {tr(
            'Versuche einen anderen Namen oder ein Gerät.',
            'Try another name or a piece of equipment.',
          )}
        </Copy>
      ) : null}
      {results.length > limit ? (
        <Button
          secondary
          title={tr('Weitere Übungen zeigen', 'Show more exercises')}
          onPress={() => setLimit(current => current + 40)}
        />
      ) : null}
      <Button
        secondary
        small
        title={tr('Schließen', 'Close')}
        onPress={onClose}
      />
    </Sheet>
  );
}
