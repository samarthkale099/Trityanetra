def sort_array(sequence):
    length = len(sequence)
    for pass_num in range(length):
        for idx in range(0, length - pass_num - 1):
            if sequence[idx] > sequence[idx + 1]:
                left = sequence[idx]
                sequence[idx] = sequence[idx + 1]
                sequence[idx + 1] = left
    return sequence
