export const SEARCH_PROBLEM_TEMPLATE = `from polysearch.interfaces import StateSpaceProblem


class Problem(StateSpaceProblem):
    def initial_state(self):
        # Return the starting state. Can be any hashable value -- a tuple
        # works well.
        return (0, 0)

    def goal_check(self, state):
        # Return True if this state is a goal state.
        return state == (3, 3)

    def operators(self):
        # Return the operators (functions) applicable to any state.
        return [self.move_right, self.move_down]

    def apply_operator(self, operator, state):
        # Apply one operator to a state, returning the resulting state
        # (or None if the move is invalid).
        return operator(state)

    def cost(self, state1, state2):
        # Return the cost of moving from state1 to state2.
        return 1

    def move_right(self, state):
        row, col = state
        return (row, col + 1)

    def move_down(self, state):
        row, col = state
        return (row + 1, col)
`;
