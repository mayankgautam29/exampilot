# SYNTHETIC REGULATIONS FOR DEMO — replace with institutional rules

These rules are invented for the ExamPilot demonstration. The planner, the validator and the question answering agent all read the same numbers.

## R-1 Calendar

### R-1.1 Sessions and timings
Each exam day has two sessions. Session S1 runs from 09:30 to 12:30 and session S2 runs from 14:00 to 17:00.

### R-1.2 Holidays and blocked dates
No examination is held on Saturdays, Sundays, declared holidays or dates blocked by the Controller of Examinations.

### R-1.3 Examination period
The examination period covers 10 working days. 1 declared holiday falls inside the period, so the remaining days are used for examinations.

## R-2 Student load

### R-2.1 One exam per day
A student may sit at most 1 exam per day. This is a hard rule.

### R-2.2 One exam per session
No student may be scheduled for two exams in the same session. Courses that share students are never placed in the same session.

### R-2.3 Relaxation procedure
If a timetable is impossible under rule R-2.1, the Controller of Examinations may allow up to 2 exams per day for a student, one in each session. The planner flags such a plan as relaxed and the relaxation must be approved explicitly before publication.

### R-2.4 Free day between exams
The planner prefers at least 1 free day between consecutive exams of the same student. This is a soft preference.

## R-3 Venues

### R-3.1 Maximum fill
A room may be filled to at most 85% of its usable seats.

### R-3.2 Course share
No single course may occupy more than 50% of the seats of a room, so that different courses are mixed within a room.

### R-3.3 Accessible students
Students who need accessibility support are placed in accessible ground floor rooms, in aisle seats.

### R-3.4 Extra time students
Students entitled to extra time of 25% are placed in quiet rooms.

### R-3.5 Supplementary students
Supplementary students are added to the room allocation of their course and follow the same room and seating rules.

## R-4 Invigilation

### R-4.1 Invigilator ratio
Each room needs 1 invigilator for every 30 students. Rooms with 60 or more students need at least 2 invigilators.

### R-4.2 Own course exclusion
A faculty member may not invigilate in a session in which a course they own is examined.

### R-4.3 Department preference
Invigilators should preferably be assigned to rooms hosting exams of other departments.

### R-4.4 Duty limits
A faculty member may be assigned at most 8 duties in total and at most 2 duties on one day. Duties should be shared fairly.

### R-4.5 Relievers
Every session keeps 2 relievers who are not assigned to a room and can replace an absent invigilator.

### R-4.6 Chief invigilator
In every room the most senior assigned invigilator acts as the chief invigilator.

## R-5 Seating

### R-5.1 Separation
Students of the same course must not sit next to each other in any of the 8 directions wherever capacity allows. Seats are chosen to maximise the distance between them.

### R-5.2 Same section
Students of the same course who also belong to the same section are penalised 1.5 times as much when seated near each other.

### R-5.3 Penalty scale
The seating planner scores nearby same course pairs with penalties of 100 at distance 1, 20 at distance 2 and 4 at distance 3. Neighbours to the left or right count 1.5 times and neighbours in front or behind count 1.25 times.

### R-5.4 Seat numbering
Seats are numbered by Row and Column, written Row-Col, starting from 1-1 at the front left.

### R-5.5 Blocked seats
Blocked or broken seats are never used.

## R-6 Governance

### R-6.1 Approval before publication
A plan is published only after the Controller of Examinations approves it. Nobody else and no automated agent can approve or publish a plan.

### R-6.2 Changes after publication
Any change to a published plan, such as a swap, a hotfix or a disruption response, creates a new version that needs approval again. Affected students and faculty are notified when it is published.

### R-6.3 Rollback
Returning to an earlier version is done by publishing that version again as a new version, with approval.

### R-6.4 Audit
Every decision, tool call and approval is recorded in a tamper evident audit log.

## R-7 Conduct

### R-7.1 Reporting time
Students must report to the examination room 30 minutes before the start of the session.

### R-7.2 Late entry
Late entry is permitted up to 30 minutes after the session starts. After that the student is not admitted.

### R-7.3 Identity card
A valid college identity card or hall ticket is mandatory to enter the room.

### R-7.4 Electronic devices
Mobile phones, smart watches and other electronic devices are prohibited in the examination room.

### R-7.5 Calculators
Only the non programmable calculators permitted by the course instructor may be used, and only when the question paper allows them.

### R-7.6 Malpractice
Any suspected malpractice must be reported by the invigilator to the chief invigilator immediately.
