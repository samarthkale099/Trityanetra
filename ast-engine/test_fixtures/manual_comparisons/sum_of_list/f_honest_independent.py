def total(values):
    running_sum = 0
    index = 0
    while index < len(values):
        running_sum += values[index]
        index += 1
    return running_sum
