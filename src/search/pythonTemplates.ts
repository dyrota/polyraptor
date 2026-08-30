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

export const SEARCH_ALGORITHM_TEMPLATE = `def algorithm(problem, on_step=None):
    # Write your own search algorithm. \`problem\` satisfies the
    # StateSpaceProblem contract (initial_state/goal_check/operators/
    # apply_operator/cost), whether it's a built-in problem or one you
    # authored yourself.
    #
    # Call on_step({'type': ..., ...}) if you want to drive the visualizer --
    # 'expand'/'generate'/'reject'/'goal' match the built-in algorithms'
    # vocabulary for the richest animation, but any event shape still shows
    # up in a generic trace log.
    visited = set()
    stack = [(problem.initial_state(), [])]

    while stack:
        state, path = stack.pop()
        if on_step:
            on_step({'type': 'expand', 'state': state})
        if problem.goal_check(state):
            return path + [state]
        if state in visited:
            continue
        visited.add(state)
        for operator in problem.operators():
            successor = problem.apply_operator(operator, state)
            if successor is not None and successor not in visited:
                stack.append((successor, path + [state]))

    return None
`;
