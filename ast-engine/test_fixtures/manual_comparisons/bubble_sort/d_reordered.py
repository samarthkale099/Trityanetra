def bubble_sort(items):
    working = items
    size = len(items)
    for i in range(size):
        for j in range(0, size - i - 1):
            if working[j] > working[j + 1]:
                working[j], working[j + 1] = working[j + 1], working[j]
    return working
