def prime_check(number):
    if number <= 1:
        return False
    candidate = 2
    while candidate < number:
        remainder = number % candidate
        if remainder == 0:
            return False
        candidate = candidate + 1
    return True
