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
