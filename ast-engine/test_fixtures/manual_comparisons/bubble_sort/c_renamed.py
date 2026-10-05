def bubble_sort(data):
    # repeatedly swap adjacent out-of-order pairs
    length = len(data)
    buffer = data

    for outer in range(length):
        for inner in range(0, length - outer - 1):
            if data[inner] > data[inner + 1]:
                data[inner], data[inner + 1] = data[inner + 1], data[inner]

    return buffer
