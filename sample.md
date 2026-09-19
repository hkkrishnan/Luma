---
type: luma-workspace
version: 1
title: Luma sample workspace
---

# Luma sample workspace

## Profile: Work

### Tasks

```yaml
- id: "work-overdue"
  title: "Send the project recap"
  status: "open"
  importance: "important"
  dueDate: "2026-09-15"
  notes: "Include **decisions**, risks, and next steps."
  project: "Launch"
  tags: ["writing", "follow-up"]
- id: "work-today"
  title: "Review Q4 experiment plan"
  status: "in-progress"
  importance: "important"
  dueDate: "2026-09-18"
  notes: "Check the measurement plan before the afternoon review."
  project: "Growth"
  tags: ["review"]
- id: "work-tomorrow"
  title: "Prepare customer workshop agenda"
  status: "open"
  importance: "important"
  dueDate: "2026-09-19"
  notes: "Draft a 45-minute agenda and share it with the team."
  project: "Customer success"
  tags: ["planning"]
- id: "work-week"
  title: "Book time for design critique"
  status: "open"
  importance: "less-important"
  dueDate: "2026-09-23"
  notes: ""
  project: "Design system"
  tags: ["calendar"]
- id: "work-later"
  title: "Read the industry research report"
  status: "open"
  importance: "less-important"
  notes: "Capture three useful ideas in the workspace notes."
  project: "Learning"
  tags: ["reading"]
- id: "work-waiting"
  title: "Wait for vendor security questionnaire"
  status: "waiting"
  importance: "less-important"
  dueDate: "2026-10-02"
  notes: "Follow up if no reply by the due date."
  project: "Operations"
  tags: ["vendor"]
- id: "work-completed"
  title: "Share sprint demo recording"
  status: "completed"
  importance: "important"
  dueDate: "2026-09-12"
  completedAt: "2026-09-12T17:30:00.000Z"
  notes: "Sent to the product channel."
  project: "Delivery"
  tags: ["completed"]
```

### Notes

```text
## Work scratchpad

This is a sample workspace note. Try selecting this sentence and pressing **Ctrl/Cmd+B** to toggle bold text.

- Questions for the next planning meeting
- Ideas worth revisiting later
```

## Profile: Personal

### Tasks

```yaml
- id: "personal-overdue"
  title: "Return library books"
  status: "open"
  importance: "less-important"
  dueDate: "2026-09-14"
  notes: "Bring the books when running errands."
  project: "Home"
  tags: ["errands"]
- id: "personal-today"
  title: "Call the dentist"
  status: "open"
  importance: "less-important"
  dueDate: "2026-09-18"
  notes: "Ask about an afternoon appointment."
  project: "Health"
  tags: ["call"]
- id: "personal-week"
  title: "Plan a weekend hike"
  status: "open"
  importance: "important"
  dueDate: "2026-09-26"
  notes: "Pick a trail, check the forecast, and invite friends."
  project: "Outdoors"
  tags: ["weekend"]
- id: "personal-later"
  title: "Organize photo backups"
  status: "open"
  importance: "less-important"
  notes: "Start with the phone photos from this year."
  project: "Home"
  tags: ["maintenance"]
- id: "personal-completed"
  title: "Replace the hallway light bulb"
  status: "completed"
  importance: "less-important"
  dueDate: "2026-09-10"
  completedAt: "2026-09-10T18:00:00.000Z"
  notes: "Used a warm LED bulb."
  project: "Home"
  tags: ["completed"]
```

### Notes

```text
## Personal scratchpad

Use this space for **quick notes**, lists, and ideas.

Remember to test a task with no date: it appears in Later.
```
