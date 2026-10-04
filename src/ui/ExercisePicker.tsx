import React, { useMemo, useState } from 'react';
import { CATALOG, searchCatalog } from '../domain/catalog';
import { EQUIPMENT_LABEL } from '../domain/catalogData';
import type { Exercise } from '../domain/strength';
import { Button, Copy, Input, Row, Sheet } from './components';

/** Die lokale Sammlung bleibt auch ohne Netz vollständig durchsuchbar. */
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
    <Sheet visible={visible} title="Übung wählen" onClose={onClose}>
      <Input
        label="Übung suchen"
        value={query}
        onChangeText={value => {
          setQuery(value);
          setLimit(40);
        }}
      />
      {results.slice(0, limit).map(exercise => (
        <Row
          key={exercise.id}
          title={exercise.name}
          subtitle={[
            EQUIPMENT_LABEL[exercise.equipment],
            ...(exercise.muscleGroups ?? []),
          ].join(' · ')}
          onPress={() => {
            setQuery('');
            setLimit(40);
            onSelect(exercise);
          }}
        />
      ))}
      {!results.length ? (
        <Copy muted>Versuche einen anderen Namen oder ein Gerät.</Copy>
      ) : null}
      {results.length > limit ? (
        <Button
          secondary
          title="Weitere Übungen zeigen"
          onPress={() => setLimit(current => current + 40)}
        />
      ) : null}
      <Button secondary small title="Schließen" onPress={onClose} />
    </Sheet>
  );
}
