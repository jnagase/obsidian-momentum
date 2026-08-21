# Requirements Document

## Introduction

The Fitness module of the Momentum Life Obsidian plugin currently models every Exercise as a strength-training movement: each Exercise record carries a required `weight` (kg) and `sets` (e.g. `3x10`), grouped into a Split that represents a muscle group (e.g. "Peito/Ombro/Tríceps"). There is no concept of distance, pace, or activity type, so cardio activities (running, cycling, rowing, etc.) have no correct place in the data model, the Workout Editor, the Logged Workout View, or the progress charts.

This feature introduces an `Exercise Kind` of `"strength"` or `"cardio"` on Exercise records, derives a corresponding `Workout Kind` on logged Workouts, and adds cardio-specific fields (distance, duration, and a computed pace) alongside the existing strength fields. The Exercise Editor, Workout Editor, and Logged Workout View adapt which fields they show based on Exercise Kind. The existing Weight Progress Chart continues to cover strength Exercises, and a new Cardio Progress Chart covers cardio Exercises. The Fitness Month Hub gains a total-distance summary for months with cardio activity.

The change extends the existing schema with fields that default when absent, so existing Exercise and Workout notes keep working without a migration step. The MCP Fitness Store (`mcp/src/store.mjs`) mirrors the same Exercise Kind, Workout Kind, and cardio fields as the plugin's Fitness Data Store, so both stay consistent.

## Glossary

- **Fitness Module**: The `FitnessModule` component (`src/modules/fitness.ts`) that renders the Fitness page: workout plan, Workout Editor, Logged Workout View, calendar, and progress charts.
- **Fitness Data Store**: The data-layer methods in `PADataStore` (`src/data.ts`) that load, save, and delete Exercise, Split, and Workout records and regenerate the Fitness Month Hub.
- **Exercise**: A stored exercise definition (`Fitness/Exercises/*.md`) that belongs to a Split and carries either strength fields (weight, sets) or cardio fields (target distance, target duration), depending on its Exercise Kind.
- **Exercise Kind**: A classification of `"strength"` or `"cardio"` stored on an Exercise, and carried onto each Workout Exercise Entry logged from that Exercise.
- **Split**: A named workout slot (e.g. "Peito/Ombro/Tríceps") that groups Exercises. A Split's Exercises may mix Exercise Kind values.
- **Workout**: A logged training session (`Fitness/Workouts/*.md`) for one Split on one date, containing a duration and a list of Workout Exercise Entries.
- **Workout Kind**: A value of `"strength"`, `"cardio"`, `"mixed"`, or `"empty"` derived on a Workout from the Exercise Kind values of that Workout's Workout Exercise Entries.
- **Workout Exercise Entry**: One item within a Workout's exercises list, recording either weight and sets (Exercise Kind `"strength"`) or distance and duration (Exercise Kind `"cardio"`) for one Exercise at logging time.
- **Pace**: A computed value expressing minutes per kilometer for a Workout Exercise Entry of Exercise Kind `"cardio"`, derived from that entry's duration and distance.
- **Exercise Editor**: The modal (`openExerciseModal`) used to create or edit an Exercise.
- **Workout Editor**: The panel (`renderWorkoutEditor`) used to view and edit the Exercises of the active Split, start a session, and finish a Workout.
- **Logged Workout View**: The panel (`renderLoggedWorkout`) that shows a previously logged Workout's Workout Exercise Entries for editing.
- **Weight Progress Chart**: The existing chart (`renderWeightProgress`) that plots weight history for strength Exercises of a selected Split.
- **Cardio Progress Chart**: A chart that plots distance history for cardio Exercises of a selected Split.
- **Month Hub Generator**: The `syncMonthHub` routine and its Fitness-specific configuration (`fitnessHubConfig`, `fitnessHubBody`) that regenerate the Fitness Month Hub for a month.
- **Fitness Month Hub**: The consolidated monthly note (`Fitness/Months/Fitness <YYYY-MM Month>.md`) summarizing a month's workouts.
- **MCP Fitness Store**: The Node port of the Fitness Data Store in `mcp/src/store.mjs`, used by the MCP server.

## Requirements

### Requirement 1: Exercise Kind Classification and Cardio Template Fields

**User Story:** As a user maintaining my workout plan, I want to classify each Exercise as strength or cardio and give cardio Exercises their own target fields, so that my plan shows the right inputs for each activity type.

#### Acceptance Criteria

1. THE Fitness Data Store SHALL classify every Exercise record by an Exercise Kind value of `"strength"` or `"cardio"`.
2. WHERE a stored Exercise record has no Exercise Kind value, THE Fitness Data Store SHALL treat that Exercise as Exercise Kind `"strength"`.
3. WHEN a user creates or edits an Exercise, THE Exercise Editor SHALL let the user select the Exercise Kind.
4. WHEN the Exercise Kind of an Exercise is `"strength"`, THE Exercise Editor SHALL display the weight and sets fields and SHALL omit the distance and duration fields.
5. WHEN the Exercise Kind of an Exercise is `"cardio"`, THE Exercise Editor SHALL display the target distance and target duration fields and SHALL omit the weight and sets fields.
6. THE Fitness Data Store SHALL store an Exercise record of Exercise Kind `"cardio"` with a target distance in kilometers and a target duration in minutes.

### Requirement 2: Cardio Metrics on Logged Workout Exercise Entries

**User Story:** As a user logging a run or ride, I want to record distance and duration for that entry and see a computed pace, so that I can track cardio performance the way I track strength progress today.

#### Acceptance Criteria

1. THE Fitness Data Store SHALL store a Workout Exercise Entry of Exercise Kind `"cardio"` with a distance in kilometers and a duration in minutes.
2. WHEN a Workout Exercise Entry has a distance value greater than zero and a duration value greater than zero, THE Fitness Module SHALL compute the pace for that entry as the duration divided by the distance, expressed in minutes per kilometer and rounded to one decimal place.
3. IF a Workout Exercise Entry has a distance value of zero or a duration value of zero, THEN THE Fitness Module SHALL treat the pace for that entry as unavailable rather than computing a division result.
4. IF a user attempts to save a Workout Exercise Entry of Exercise Kind `"cardio"` with a distance value that is not greater than zero or a duration value that is not greater than zero, THEN THE Workout Editor SHALL reject the save and SHALL leave that entry unchanged.

### Requirement 3: Workout Kind Derivation

**User Story:** As a user reviewing a logged workout, I want the workout to reflect whether it was strength, cardio, or a mix of both, so that I can understand the session's composition at a glance.

#### Acceptance Criteria

1. WHERE every Workout Exercise Entry within a Workout has Exercise Kind `"strength"`, THE Fitness Data Store SHALL set that Workout's Workout Kind to `"strength"`.
2. WHERE every Workout Exercise Entry within a Workout has Exercise Kind `"cardio"`, THE Fitness Data Store SHALL set that Workout's Workout Kind to `"cardio"`.
3. WHERE a Workout contains at least one Workout Exercise Entry of Exercise Kind `"strength"` and at least one Workout Exercise Entry of Exercise Kind `"cardio"`, THE Fitness Data Store SHALL set that Workout's Workout Kind to `"mixed"`.
4. IF a Workout has zero Workout Exercise Entries, THEN THE Fitness Data Store SHALL set that Workout's Workout Kind to `"empty"`.
5. WHERE a stored Workout record has no Workout Kind value, THE Fitness Data Store SHALL treat that Workout as Workout Kind `"strength"`.

### Requirement 4: Workout Editor and Logged Workout View Field Selection

**User Story:** As a user working through a session, I want the Workout Editor and the Logged Workout View to show weight/sets for strength entries and distance/duration for cardio entries, so that the input fields always match the activity.

#### Acceptance Criteria

1. WHEN the Workout Editor renders a row for a Workout Exercise Entry of Exercise Kind `"strength"`, THE Workout Editor SHALL show weight and sets input fields for that row.
2. WHEN the Workout Editor renders a row for a Workout Exercise Entry of Exercise Kind `"cardio"`, THE Workout Editor SHALL show distance and duration input fields for that row.
3. WHEN the Logged Workout View renders a row for a Workout Exercise Entry of Exercise Kind `"strength"`, THE Logged Workout View SHALL show weight and sets fields for that row.
4. WHEN the Logged Workout View renders a row for a Workout Exercise Entry of Exercise Kind `"cardio"`, THE Logged Workout View SHALL show distance and duration fields for that row.
5. WHEN a user saves edits to a Workout Exercise Entry of Exercise Kind `"strength"`, THE Fitness Data Store SHALL persist the weight and sets values for that entry.
6. WHEN a user saves edits to a Workout Exercise Entry of Exercise Kind `"cardio"`, THE Fitness Data Store SHALL persist the distance and duration values for that entry.

### Requirement 5: Cardio Progress Visualization

**User Story:** As a user training cardio, I want to see my distance progress over time per split, so that I can track improvement the same way I track weight progress for strength training.

#### Acceptance Criteria

1. THE Fitness Module SHALL provide a Cardio Progress Chart that plots the logged distance of cardio Workout Exercise Entries over time for a selected Split.
2. WHERE a Split contains at least one Exercise of Exercise Kind `"cardio"`, THE Fitness Module SHALL include a data series for that Exercise in the Cardio Progress Chart.
3. THE Weight Progress Chart SHALL plot only Workout Exercise Entries of Exercise Kind `"strength"`.
4. WHERE a Split contains zero Exercises of Exercise Kind `"cardio"`, THE Fitness Module SHALL render the Cardio Progress Chart for that Split with zero data series.

### Requirement 6: Monthly Fitness Hub Cardio Summary

**User Story:** As a user reviewing my training month, I want the Fitness Month Hub to show total distance covered, so that I can see my cardio volume alongside session count and minutes.

#### Acceptance Criteria

1. WHEN the Month Hub Generator regenerates the Fitness Month Hub for a month, THE Month Hub Generator SHALL compute the total distance for that month as the sum of the distance values of all cardio Workout Exercise Entries logged in that month.
2. WHEN a month has at least one cardio Workout Exercise Entry, THE Month Hub Generator SHALL include the total distance in kilometers in that month's Fitness Month Hub.
3. WHERE a month has zero cardio Workout Exercise Entries, THE Month Hub Generator SHALL omit the total distance line from that month's Fitness Month Hub.
4. IF the Month Hub Generator cannot determine whether a month has cardio Workout Exercise Entries, THEN THE Month Hub Generator SHALL log the failure and SHALL omit the total distance line from that month's Fitness Month Hub.

### Requirement 7: Backward Compatibility and Non-Destructive Schema Extension

**User Story:** As a maintainer, I want existing Exercise and Workout data to keep working without a migration step, so that the upgrade is transparent to users with existing vaults.

#### Acceptance Criteria

1. THE Fitness Data Store SHALL load existing Exercise and Workout records that predate the Exercise Kind and Workout Kind fields without error.
2. THE Fitness Data Store SHALL extend the Exercise, Workout, and Workout Exercise Entry schemas using optional fields that carry the defaults defined in Requirement 1, Requirement 2, and Requirement 3, requiring no migration step.
3. WHEN the Fitness Data Store reads or writes an Exercise or Workout record of Exercise Kind `"strength"`, THE Fitness Data Store SHALL preserve every existing frontmatter field of that record unchanged.
4. IF the Fitness Data Store cannot guarantee that an existing frontmatter field of an Exercise or Workout record of Exercise Kind `"strength"` will be preserved unchanged, THEN THE Fitness Data Store SHALL fail that read operation rather than return a record with a silently dropped field.

### Requirement 8: MCP Fitness Store Parity

**User Story:** As a maintainer, I want the MCP Fitness Store to mirror the plugin's Fitness Data Store schema changes, so that the plugin and the MCP stay consistent.

#### Acceptance Criteria

1. THE MCP Fitness Store SHALL apply the same Exercise Kind, Workout Kind, and cardio metric fields defined in Requirement 1, Requirement 2, and Requirement 3 to its Exercise, Workout, and Workout Exercise Entry records.
2. WHERE a stored Exercise or Workout record loaded by the MCP Fitness Store has no Exercise Kind or Workout Kind value, THE MCP Fitness Store SHALL apply the same defaults as the Fitness Data Store.
3. THE MCP Fitness Store's Fitness Month Hub summary SHALL compute the same total distance figure as the Month Hub Generator for equivalent Workout data.
4. IF the MCP Fitness Store's total distance figure differs from the Month Hub Generator's total distance figure for equivalent Workout data, THEN THE MCP Fitness Store SHALL continue processing and SHALL log the discrepancy.
