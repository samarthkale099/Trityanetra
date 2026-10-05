def sum_list(values):
    # accumulate the running total
    result = 0
    amount = len(values)

    for item in values:
        result = result + item

    return result
