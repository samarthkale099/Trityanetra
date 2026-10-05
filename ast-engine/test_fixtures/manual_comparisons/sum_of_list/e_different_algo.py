def sum_of_list(numbers):
    if not numbers:
        return 0
    return numbers[0] + sum_of_list(numbers[1:])
