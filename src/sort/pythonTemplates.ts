export const SORT_PROBLEM_TEMPLATE = `from polysort.interfaces import SortProblem


class Problem(SortProblem):
    def data(self):
        # Return the list of numbers to sort.
        return [5, 3, 8, 1, 9, 2]

    def comparator(self, a, b):
        # Return -1 if a should come before b, 1 if after, 0 if equal.
        if a < b:
            return -1
        if a > b:
            return 1
        return 0
`;

export const SORT_ALGORITHM_TEMPLATE = `def algorithm(problem, on_step=None):
    # Write your own sort algorithm. \`problem\` satisfies the SortProblem
    # contract (data()/comparator(a, b)), whether it's a built-in problem or
    # one you authored yourself.
    #
    # Call on_step({'type': ..., ...}) if you want to drive the visualizer --
    # 'compare'/'swap'/'write'/'mark' match the built-in algorithms'
    # vocabulary for the richest animation, but any event shape still shows
    # up in a generic trace log.
    data = problem.data().copy()
    n = len(data)
    for i in range(n):
        for j in range(0, n - i - 1):
            if on_step:
                on_step({'type': 'compare', 'a': {'buffer': 'main', 'index': j, 'value': data[j]}, 'b': {'buffer': 'main', 'index': j + 1, 'value': data[j + 1]}})
            if problem.comparator(data[j], data[j + 1]) > 0:
                data[j], data[j + 1] = data[j + 1], data[j]
                if on_step:
                    on_step({'type': 'swap', 'a': {'buffer': 'main', 'index': j}, 'b': {'buffer': 'main', 'index': j + 1}})
    return data
`;
